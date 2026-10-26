/**
 * Host half of the OpenCode Go usage bundle.
 *
 * Resolves the OpenCode Go API key (plugin config, the Harness credential
 * service, or the key OpenCode itself stores), calls
 * `GET https://opencode.ai/zen/go/v1/usage`, and publishes the latest snapshot
 * to the browser over one same-origin JSON route.
 *
 * Polling is demand driven: the Client half asks for the route every ~20s and
 * the Host refetches only when the cached snapshot is older than
 * `minIntervalMs`. A hidden page stops asking, so an idle page costs nothing;
 * a visible page costs at most one upstream call per poll interval, shared by
 * every open page.
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const API_URL = 'https://opencode.ai/zen/go/v1/usage';
/** Must stay in sync with ROUTE in client.js: the browser half polls this path. */
const ROUTE_PATH = '/opencode-go-usage.json';
const DEFAULT_PROVIDER = 'opencode-go';
const DEFAULT_CREDENTIAL_REF = 'OPENCODE_GO_API_KEY';
const DEFAULT_MIN_INTERVAL_MS = 15000;
const REQUEST_TIMEOUT_MS = 15000;
const WINDOWS = ['rolling', 'weekly', 'monthly'];

/** Coerce a config number into an integer inside `[min, max]`. */
function boundedInt(value, fallback, min, max) {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Clamp an API percentage into `[0, 100]`; anything unusable counts as 0. */
function clampPercent(value) {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n * 10) / 10));
}

/** Normalize one usage window from either API shape; `undefined` when absent. */
function normalizeWindow(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const percent = raw.percent ?? raw.usagePercent ?? raw.used;
  const resetsAt = typeof raw.resetsAt === 'string' ? raw.resetsAt : null;
  const status = typeof raw.status === 'string' ? raw.status : 'ok';
  return { percent: clampPercent(percent), resetsAt, status };
}

/**
 * Fold a usage payload into the snapshot the Client renders.
 * Accepts `{ usage: { rolling, weekly, monthly } }` and the older
 * `{ rollingUsage, weeklyUsage, monthlyUsage }` form.
 */
function normalizeUsage(payload) {
  const container = payload && typeof payload === 'object' ? (payload.usage ?? payload) : {};
  const windows = {};
  for (const key of WINDOWS) {
    windows[key] = normalizeWindow(container[key] ?? container[`${key}Usage`]);
  }
  return {
    windows,
    useBalance: payload?.useBalance === true,
  };
}

/** Candidate OpenCode auth files, most specific first. */
function authFileCandidates() {
  const home = homedir();
  const dataHome = process.env.XDG_DATA_HOME;
  const candidates = [];
  if (dataHome) candidates.push(join(dataHome, 'opencode', 'auth.json'));
  if (home) candidates.push(join(home, '.local', 'share', 'opencode', 'auth.json'));
  if (process.env.LOCALAPPDATA) candidates.push(join(process.env.LOCALAPPDATA, 'opencode', 'auth.json'));
  if (process.env.APPDATA) candidates.push(join(process.env.APPDATA, 'opencode', 'auth.json'));
  return candidates;
}

/** Read the provider key OpenCode stores after `/connect`; `undefined` when absent. */
async function readOpencodeAuthKey(provider) {
  for (const file of authFileCandidates()) {
    let text;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    try {
      const parsed = JSON.parse(text);
      const entry = parsed?.[provider];
      const key = typeof entry === 'string' ? entry : entry?.key;
      if (typeof key === 'string' && key.trim() !== '') return key.trim();
    } catch {
      // A malformed auth file must not take the plugin down.
    }
  }
  return undefined;
}

/** Map an HTTP failure into a stable code the Client localizes. */
function failureFromResponse(status, body) {
  const code = body?.error?.code ?? body?.error?.type ?? body?.code;
  if (status === 401 && code === 'api_key_expired') {
    return { code: 'key_expired', message: body?.error?.message ?? 'The OpenCode Go API key has expired.' };
  }
  if (status === 401) {
    return { code: 'unauthorized', message: body?.error?.message ?? 'The OpenCode Go API key was rejected.' };
  }
  if (status === 403) {
    return { code: 'no_subscription', message: body?.error?.message ?? 'This workspace has no OpenCode Go subscription.' };
  }
  if (status === 404) {
    return { code: 'unavailable', message: 'The OpenCode Go usage endpoint is unavailable.' };
  }
  return { code: 'http_error', message: `OpenCode Go usage request failed with HTTP ${status}.` };
}

/** Read a response body as JSON; an abort during the body read stays an abort. */
async function readJson(response) {
  try {
    return await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    return undefined;
  }
}

/** Cordis plugin entry. */
export function apply(ctx, config) {
  const settings = config && typeof config === 'object' ? config : {};
  const provider = typeof settings.provider === 'string' && settings.provider.trim() !== '' ? settings.provider.trim() : DEFAULT_PROVIDER;
  const credentialRef =
    typeof settings.credentialRef === 'string' && settings.credentialRef.trim() !== ''
      ? settings.credentialRef.trim()
      : DEFAULT_CREDENTIAL_REF;
  const minIntervalMs = boundedInt(settings.minIntervalMs, DEFAULT_MIN_INTERVAL_MS, 2000, 600000);
  const fixedApiKey = typeof settings.apiKey === 'string' ? settings.apiKey.trim() : '';

  let snapshot = { ok: false, code: 'pending', message: 'Usage has not been fetched yet.', fetchedAtMs: 0 };
  let inflight;

  /** Resolve the API key for one call: explicit config, then Harness credentials, then OpenCode's own file. */
  async function resolveApiKey() {
    if (fixedApiKey !== '') return { key: fixedApiKey, source: 'config' };
    const credentials = ctx.get('credentials');
    if (credentials && typeof credentials.resolve === 'function') {
      try {
        const resolved = await credentials.resolve(credentialRef);
        const value = typeof resolved === 'string' ? resolved : resolved?.value;
        if (typeof value === 'string' && value.trim() !== '') return { key: value.trim(), source: 'credential' };
      } catch {
        // Fall through to OpenCode's own store.
      }
    }
    const stored = await readOpencodeAuthKey(provider);
    if (stored !== undefined) return { key: stored, source: 'opencode-auth' };
    return undefined;
  }

  /** One upstream read; never throws, always lands in `snapshot`. */
  async function fetchUsage() {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let source = 'none';
    try {
      const resolved = await resolveApiKey();
      if (resolved === undefined) {
        snapshot = {
          ok: false,
          code: 'not_configured',
          message: `No OpenCode Go API key found. Add ${credentialRef} to the Harness credentials, or connect OpenCode Go in OpenCode.`,
          fetchedAtMs: startedAt,
          source,
        };
        return;
      }
      source = resolved.source;
      const response = await fetch(API_URL, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${resolved.key}`,
          accept: 'application/json',
          'user-agent': 'dsh-opencode-go-usage/0.1',
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await readJson(response);
        const failure = failureFromResponse(response.status, body);
        snapshot = { ...failure, ok: false, fetchedAtMs: Date.now(), source };
        return;
      }
      const payload = await readJson(response);
      const normalized = normalizeUsage(payload);
      const missing = WINDOWS.filter((key) => normalized.windows[key] === undefined);
      if (missing.length > 0) {
        snapshot = {
          ok: false,
          code: 'unexpected_payload',
          message: `The usage response is missing the ${missing.join(', ')} window.`,
          fetchedAtMs: Date.now(),
          source,
        };
        return;
      }
      snapshot = {
        ok: true,
        windows: normalized.windows,
        useBalance: normalized.useBalance,
        fetchedAtMs: Date.now(),
        source,
      };
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      snapshot = {
        ok: false,
        code: aborted ? 'timeout' : 'network_error',
        message: aborted
          ? 'The OpenCode Go usage request timed out.'
          : `Could not reach opencode.ai: ${error instanceof Error ? error.message : String(error)}`,
        fetchedAtMs: Date.now(),
        source,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Share one in-flight request and refetch only when the cache is older than the floor. */
  async function ensureFresh(force) {
    const age = Date.now() - snapshot.fetchedAtMs;
    if (!force && age >= 0 && age < minIntervalMs) return snapshot;
    if (inflight === undefined) {
      inflight = fetchUsage().finally(() => {
        inflight = undefined;
      });
    }
    await inflight;
    return snapshot;
  }

  /** The wire payload: the snapshot plus the server clock the Client uses for countdowns. */
  function wirePayload() {
    return JSON.stringify({ now: Date.now(), snapshot });
  }

  /** Answer one route request; always ends the response, including on an unexpected failure. */
  async function handleRoute(req, res) {
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('allow', 'GET, HEAD');
      res.end();
      return;
    }
    const force = /(?:^|[?&])refresh=1(?:&|$)/.test(req.url ?? '');
    await ensureFresh(force);
    const body = wirePayload();
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('content-length', Buffer.byteLength(body));
    if (method === 'HEAD') res.end();
    else res.end(body);
  }

  let routeRegistered = false;

  /** Register the JSON route on a context whose `webServer` is live. */
  function registerRoute(hostCtx) {
    if (routeRegistered) return;
    const server = hostCtx.get('webServer');
    if (!server || typeof server.register !== 'function') return;
    routeRegistered = true;
    hostCtx.effect(() =>
      server.register({
        kind: 'exact',
        path: ROUTE_PATH,
        handler: async (req, res) => {
          try {
            await handleRoute(req, res);
          } catch (error) {
            // A rejected handler must still settle the browser's fetch.
            try {
              const body = JSON.stringify({
                now: Date.now(),
                snapshot: {
                  ok: false,
                  code: 'internal_error',
                  message: error instanceof Error ? error.message : String(error),
                  fetchedAtMs: Date.now(),
                  source: 'host',
                },
              });
              res.statusCode = 500;
              res.setHeader('content-type', 'application/json; charset=utf-8');
              res.setHeader('cache-control', 'no-store');
              res.end(body);
            } catch {
              try {
                res.statusCode = 500;
                res.end();
              } catch {
                // The response is already gone.
              }
            }
          }
        },
      }),
    );
    // Warm the cache once so the first paint does not wait for a round trip.
    hostCtx.effect(() => {
      void ensureFresh(false);
    });
  }

  if (typeof ctx.inject === 'function') {
    // Follows the webServer lifetime, so a replaced service re-registers the route.
    ctx.inject(['webServer'], (webCtx) => registerRoute(webCtx));
    // The service may already be live when this fiber seeds; register now rather than one tick later.
    registerRoute(ctx);
  } else {
    registerRoute(ctx);
  }
  if (!routeRegistered) {
    ctx.logger?.warn?.('[opencode-go-usage] webServer is unavailable in this profile; the usage meter has no data route.');
  }
}
