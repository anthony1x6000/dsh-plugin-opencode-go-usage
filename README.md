# dsh-plugin-opencode-go-usage

Install this fork in one line (requires the `dsh` CLI and `pnpm`):

```bash
dsh plugin --profile web add "github:anthony1x6000/dsh-plugin-opencode-go-usage#main"
```

Replace `web` with the profile you actually use. The command writes the bundle into that profile's `dsh.profile.bundles`; it takes effect immediately with HMR, otherwise restart `dsh web`.

[![npm version](https://img.shields.io/npm/v/dsh-plugin-opencode-go-usage?style=flat-square)](https://www.npmjs.com/package/dsh-plugin-opencode-go-usage)
[![npm downloads](https://img.shields.io/npm/dw/dsh-plugin-opencode-go-usage?style=flat-square)](https://www.npmjs.com/package/dsh-plugin-opencode-go-usage)
[![license](https://img.shields.io/github/license/anthony1x6000/dsh-plugin-opencode-go-usage.svg)](LICENSE)
[![release](https://img.shields.io/github/v/release/anthony1x6000/dsh-plugin-opencode-go-usage?style=flat-square)](https://github.com/anthony1x6000/dsh-plugin-opencode-go-usage/releases)

Live OpenCode Go subscription usage for DeepSeek Harness, as a compact meter in the composer dock: the rolling 5-hour, weekly and monthly windows as small rings with used percentages (70% amber, 90% red), plus a click-open detail card with per-window progress bars and reset countdowns. The Host half polls `https://opencode.ai/zen/go/v1/usage` on demand and serves one same-origin JSON route, so the API key never reaches the browser. The meter mounts only while the Session's active model belongs to the `opencode-go` provider.

## Features

- **Composer-dock meter**: three small rings (`5h` rolling / `Week` / `Month`) with used percentages in `conversation.composer.dock`; the ring styling matches the "context usage" ring under the composer (14px viewBox, 2px stroke, theme token colors), amber at 70%, red at 90%.
- **Model gating**: mounts only while the Session's active model belongs to `opencode-go`; a model just picked in the dropdown (before sending) shows immediately, switching to another provider unmounts the whole strip, stops polling and closes an open detail card, and a fresh Session shows nothing until a model is explicitly selected or a turn runs.
- **Click the whole strip for a detail card**: the layout mirrors the official `stat-dialog` card, one row per window (window name + right-aligned bold percentage) with quota progress bars, plus reset countdowns and reset times; the footer shows the data source, update time and a "Refresh" button, and it closes on an outside click or Esc.
- **Silent refresh**: the page reads the same-origin JSON route every 20 seconds (paused while the tab is hidden); the Host enforces a 15-second minimum upstream interval and shares one result across pages; background polling never dims or flashes, and a transient failure keeps the last good reading.
- **Key never enters the browser**: the Host resolves the key via `config → credential store → OpenCode auth.json` and calls upstream directly; the browser only receives percentages from `GET /opencode-go-usage.json`.
- **Zero npm dependencies, no build step**: `npm run validate` self-checks the manifest, syntax, locale, icon and style tokens.

## Install

### One-line install (recommended)

```bash
dsh plugin --profile web add "github:anthony1x6000/dsh-plugin-opencode-go-usage#main"
```

Requires the `dsh` CLI and `pnpm`; replace `web` with the profile you actually use. The command writes the bundle into that profile's `dsh.profile.bundles`; it takes effect immediately with HMR, otherwise restart `dsh web`.

> The `dsh-plugin-opencode-go-usage` package on npm is published by upstream and does not include this fork's model gating; to install this fork's code, use the command above.

### Install from npm (upstream version)

Published on npm: [`dsh-plugin-opencode-go-usage`](https://www.npmjs.com/package/dsh-plugin-opencode-go-usage).

In Harness, install this bundle with the plugin manager, using the npm package name as the target (a version is optional):

```text
plugin_manager install_bundle  target: dsh-plugin-opencode-go-usage
# or pin a version
plugin_manager install_bundle  target: dsh-plugin-opencode-go-usage@1.0.1
```

### Install from a GitHub release (offline, pinned)

Download `dsh-plugin-opencode-go-usage-<version>.tgz` from [Releases](https://github.com/anthony1x6000/dsh-plugin-opencode-go-usage/releases), then give the plugin manager that file's absolute path, or:

```text
plugin_manager install_bundle  target: <absolute path to the downloaded .tgz>
```

### Install from a local directory (development)

```text
plugin_manager install_bundle  target: <absolute path to this repository>
```

Installed changes take effect immediately: the Host row activates and the browser bundle loads into the page via HMR (refresh the page once if needed). Uninstall:

```text
plugin_manager remove_bundle  target: dsh-plugin-opencode-go-usage
```

Requirement: the DSH web composition (includes `webserver` / `client-modules` / `client-ui-conversation`).

## Usage

The meter roughly looks like: `Go  5h ◔6%  ·  Week ◔2%  ·  Month ◔15%`

There are no hover details; click the whole strip to open the detail card. The card is `max-content` wide, capped at `min(440px, 100vw - 24px)`; the detail area is a two-column grid `minmax(76px,auto) / minmax(0,1fr)`, the same layout as the neighbouring "Token usage" and "Session stats" popovers.

## Data source

The Host half calls the official OpenCode usage endpoint:

```text
GET https://opencode.ai/zen/go/v1/usage
Authorization: Bearer <OpenCode Go API Key>
```

It returns something like:

```json
{
  "usage": {
    "rolling": { "status": "ok", "percent": 3, "resetsAt": "2026-10-26T04:49:14.000Z" },
    "weekly":  { "status": "ok", "percent": 1, "resetsAt": "2026-11-02T00:00:00.000Z" },
    "monthly": { "status": "ok", "percent": 14, "resetsAt": "2026-11-24T07:12:36.000Z" }
  }
}
```

`percent` is the **used percentage**; the older `{ rollingUsage, weeklyUsage, monthlyUsage }` shape is also supported.

The API key is only used inside the Host process; the browser can only read percentages from the fixed same-origin JSON route (`GET /opencode-go-usage.json`). That path is the agreement shared by both halves (`ROUTE_PATH` in `index.js` and `ROUTE` in `client.js`) and is intentionally not configurable.

## API key resolution order

1. The `apiKey` in the plugin config (hard-coded explicitly, not recommended).
2. The Harness credential service's `credentialRef`, default `OPENCODE_GO_API_KEY` — i.e. the `refs.OPENCODE_GO_API_KEY` entry in `~/.dsh/.credentials.yaml`.
3. The login information OpenCode saves itself: `opencode-go.key` in `~/.local/share/opencode/auth.json` (if the key has expired, the API returns `api_key_expired` and the meter shows "API key expired").

## Configuration

No configuration is needed by default. To adjust it, override by id in the profile's `cordis.patch.yml`:

```yaml
- id: opencode-go-usage
  name: 'dsh-plugin-opencode-go-usage'
  config:
    # Set the key directly (takes priority over the credential service)
    # apiKey: oc_sk_xxx
    credentialRef: OPENCODE_GO_API_KEY
    # Minimum upstream request interval in milliseconds (2000–600000); raise it to request less, lower it for fresher readings
    minIntervalMs: 15000
    # Provider name used in OpenCode auth.json
    provider: opencode-go
```

`minIntervalMs` is Host-side rate limiting; it only affects upstream request frequency, not the browser's 20-second reads.

## Layout

| File | Purpose |
|---|---|
| `index.js` | Host half: resolves the key, calls the usage endpoint, registers the same-origin JSON route (on-demand refresh, coalesced concurrent requests) |
| `client.js` | Browser half: dock ring meter + click-open detail card, mounts only in `opencode-go` sessions, polls the route, theme-token styling, English strings |
| `cordis.patch.yml` | Inserts the `opencode-go-usage` host row |
| `locale/*.json` | Title and description shown in the plugin manager |
| `icon.svg` | Plugin icon (original) |
| `scripts/validate.mjs` | Packaging self-check: manifest, syntax, locale, icon, style tokens |
| `test/model-gate.test.mjs` | Offline assertions: only `opencode-go`, hidden means unmounted, dock registration contract |

## Development and release

```bash
npm test                # browser-half offline assertions: model gating and dock registration contract
npm run validate        # manifest / syntax / locale / icon / style-token self-check
npm pack --dry-run      # preview the tarball contents
```

Publishing to npm is wired through GitHub: `.github/workflows/publish.yml` runs `npm publish --provenance` with OIDC (npm Trusted Publishing) when a `v*` tag is pushed, and attaches the resulting `.tgz` to the matching GitHub Release.

### Publishing (upstream project)

The upstream project has Trusted Publishing configured (`npm trust github`: repository `keyblues/dsh-plugin-opencode-go-usage`, workflow `publish.yml`, permissions publish + stage publish), so each upstream release only needs:

```bash
npm version patch|minor|major
git push --follow-tags
```

The first publish happened manually, before the package existed (Trusted Publishing cannot be configured then):

```bash
npm login
npm publish --access public     # prepublishOnly runs npm run validate first
```

This fork does not publish to npm under the upstream package name; its tags produce GitHub Releases in [anthony1x6000/dsh-plugin-opencode-go-usage](https://github.com/anthony1x6000/dsh-plugin-opencode-go-usage/releases).

## License

[MIT](LICENSE) © 2026 keyblues. Forked from [`keyblues/dsh-plugin-opencode-go-usage`](https://github.com/keyblues/dsh-plugin-opencode-go-usage).
