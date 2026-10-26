/**
 * Client half of the OpenCode Go usage bundle.
 *
 * Renders a compact, self-refreshing meter in `conversation.composer.dock`
 * beside the shipped activity and usage pills. All numbers come from the
 * Host half's same-origin route, so the API key never reaches the page.
 * Clicking the pill opens a detail card, matching the neighbouring context
 * and session-stats meters.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-opencode-go-usage',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const h = React.createElement;

    const NS = 'opencode-go-usage';
    /** Must stay in sync with ROUTE_PATH in index.js: the Host registers this exact path. */
    const ROUTE = '/opencode-go-usage.json';
    const POLL_MS = 20000;
    const WINDOW_KEYS = ['rolling', 'weekly', 'monthly'];
    const PANEL_MARGIN = 12;
    const PANEL_GAP = 8;

    const DICT = {
      en: {
        brand: 'Go',
        'win.rolling': '5h',
        'win.weekly': 'Week',
        'win.monthly': 'Month',
        loading: 'loading',
        error: 'unavailable',
        'tool.title': 'OpenCode Go usage',
        'tool.rolling': '5-hour window',
        'tool.weekly': 'Week window',
        'tool.monthly': 'Month window',
        'tool.used': 'used',
        'tool.resets': 'resets in',
        'tool.updated': 'Updated',
        'tool.click': 'Click for details',
        'tool.balance': 'Extra usage beyond the limit is billed from the Zen balance.',
        'panel.title': 'OpenCode Go usage',
        'panel.resets': 'Resets in',
        'panel.resetAt': 'reset',
        'panel.noReset': 'No reset time reported',
        'panel.source': 'Source',
        'panel.source.config': 'plugin config',
        'panel.source.credential': 'Harness credential',
        'panel.source.opencode-auth': 'OpenCode login',
        'panel.source.none': 'none',
        'panel.source.host': 'host',
        'panel.refresh': 'Refresh',
        'panel.refreshing': 'Refreshing…',
        'code.not_configured': 'No OpenCode Go API key',
        'code.key_expired': 'API key expired',
        'code.unauthorized': 'API key rejected',
        'code.no_subscription': 'No Go subscription',
        'code.unavailable': 'Usage API unavailable',
        'code.http_error': 'Usage request failed',
        'code.network_error': 'Network error',
        'code.timeout': 'Request timed out',
        'code.unexpected_payload': 'Unexpected response',
        'code.internal_error': 'Host error',
        'code.pending': 'Waiting for first reading',
        'code.host_unreachable': 'Usage route unreachable',
        'unit.min': '{n}m',
        'unit.hour': '{n}h',
        'unit.day': '{n}d',
      },
      zh: {
        brand: 'Go',
        'win.rolling': '5h',
        'win.weekly': '本周',
        'win.monthly': '本月',
        loading: '读取中',
        error: '不可用',
        'tool.title': 'OpenCode Go 套餐用量',
        'tool.rolling': '5 小时窗口',
        'tool.weekly': '本周窗口',
        'tool.monthly': '本月窗口',
        'tool.used': '已用',
        'tool.resets': '重置倒计时',
        'tool.updated': '更新于',
        'tool.click': '点击查看详情',
        'tool.balance': '超出额度后将从 Zen 余额继续计费。',
        'panel.title': 'OpenCode Go 套餐用量',
        'panel.resets': '重置倒计时',
        'panel.resetAt': '重置',
        'panel.noReset': '接口未返回重置时间',
        'panel.source': '来源',
        'panel.source.config': '插件配置',
        'panel.source.credential': 'Harness 凭据',
        'panel.source.opencode-auth': 'OpenCode 登录',
        'panel.source.none': '无',
        'panel.source.host': 'Host',
        'panel.refresh': '刷新',
        'panel.refreshing': '刷新中…',
        'code.not_configured': '未找到 OpenCode Go API Key',
        'code.key_expired': 'API Key 已过期',
        'code.unauthorized': 'API Key 被拒绝',
        'code.no_subscription': '未订阅 Go 套餐',
        'code.unavailable': '用量接口不可用',
        'code.http_error': '用量请求失败',
        'code.network_error': '网络错误',
        'code.timeout': '请求超时',
        'code.unexpected_payload': '响应格式异常',
        'code.internal_error': 'Host 内部错误',
        'code.pending': '等待首次读取',
        'code.host_unreachable': '用量路由不可达',
        'unit.min': '{n} 分',
        'unit.hour': '{n} 小时',
        'unit.day': '{n} 天',
      },
    };

    /** Best-effort locale for the module-level fallback translator. */
    function detectLocale() {
      try {
        const lang = (document.documentElement.lang || navigator.language || 'en').toLowerCase();
        return lang.startsWith('zh') ? 'zh' : 'en';
      } catch {
        return 'en';
      }
    }

    /** Fallback translator used when the slot does not hand us a bound `t`. */
    function fallbackTranslate(key, params) {
      const dict = DICT[detectLocale()] ?? DICT.en;
      const template = dict[key] ?? DICT.en[key] ?? key;
      if (!params) return template;
      return String(template).replace(/\{(\w+)\}/g, (match, name) =>
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
      );
    }

    function clampPercent(value) {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) return 0;
      return Math.min(100, Math.max(0, n));
    }

    /** Tone token for a used percentage; the CSS picks the color token. */
    function toneOf(percent) {
      if (percent >= 90) return 'danger';
      if (percent >= 70) return 'warn';
      return 'ok';
    }

    /** Compact duration for a reset countdown, localized by the caller. */
    function formatRemaining(ms, t) {
      if (!Number.isFinite(ms) || ms <= 0) return '0';
      const minutes = Math.max(1, Math.round(ms / 60000));
      if (minutes < 60) return t('unit.min', { n: minutes });
      const hours = Math.floor(minutes / 60);
      const restMinutes = minutes % 60;
      if (hours < 24) {
        const rest = restMinutes > 0 ? ' ' + t('unit.min', { n: restMinutes }) : '';
        return t('unit.hour', { n: hours }) + rest;
      }
      const days = Math.floor(hours / 24);
      const restHours = hours % 24;
      const rest = restHours > 0 ? ' ' + t('unit.hour', { n: restHours }) : '';
      return t('unit.day', { n: days }) + rest;
    }

    /** Local wall-clock reading of a reset instant, e.g. `11/02 00:00`. */
    function formatResetClock(iso) {
      const ms = Date.parse(iso);
      if (!Number.isFinite(ms)) return '';
      try {
        return new Date(ms).toLocaleString(detectLocale(), {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
      } catch {
        return new Date(ms).toLocaleString();
      }
    }

    /** Localized failure sentence for a snapshot that is not `ok`. */
    function errorText(snapshot, t) {
      const key = `code.${snapshot?.code ?? 'host_unreachable'}`;
      const localized = t(key);
      return localized === key ? t('error') : localized;
    }

    /**
     * Screen-reader summary of the trigger. The full reading lives in the
     * click-open card, so nothing is rendered on hover.
     */
    function buildAriaLabel(snapshot, t) {
      const parts = [t('tool.title')];
      if (snapshot && snapshot.ok === true) {
        for (const key of WINDOW_KEYS) {
          const window = snapshot.windows?.[key];
          if (!window) continue;
          parts.push(`${t(`tool.${key}`)} ${Math.round(clampPercent(window.percent))}%`);
        }
      } else if (snapshot && snapshot.code) {
        parts.push(errorText(snapshot, t));
      }
      return parts.join(' · ');
    }

    /** Translate through the slot's bound `t`, falling back to the bundle's own dictionaries. */
    function makeTranslator(bound) {
      if (typeof bound !== 'function') return fallbackTranslate;
      return (key, params) => {
        let value;
        try {
          value = bound(key, params);
        } catch {
          return fallbackTranslate(key, params);
        }
        return value === undefined || value === key ? fallbackTranslate(key, params) : value;
      };
    }

    /** Ring geometry, matching the shipped context meter: 14px viewBox, 2px stroke. */
    const RING_RADIUS = 5.5;
    const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

    /** One small progress ring; the drawn stroke carries the used percentage. */
    function UsageRing({ percent, tone }) {
      const filled = (RING_CIRCUMFERENCE * clampPercent(percent)) / 100;
      return h(
        'svg',
        { className: 'ocgu_ring', viewBox: '0 0 14 14', width: 14, height: 14, 'aria-hidden': true },
        h('circle', { className: 'ocgu_ring_track', cx: 7, cy: 7, r: RING_RADIUS }),
        h('circle', {
          className: 'ocgu_ring_fill',
          'data-tone': tone,
          cx: 7,
          cy: 7,
          r: RING_RADIUS,
          strokeDasharray: `${filled} ${RING_CIRCUMFERENCE}`,
          transform: 'rotate(-90 7 7)',
        }),
      );
    }

    /**
     * Place the card above the trigger, clamped into the viewport.
     * Re-measures on resize and scroll, and once after the first paint so the
     * measured panel size is used.
     */
    function useAnchoredPlacement(open, rootRef, panelRef) {
      const [position, setPosition] = React.useState(null);
      React.useEffect(() => {
        if (!open) {
          setPosition(null);
          return undefined;
        }
        const place = () => {
          const anchor = rootRef.current;
          if (!anchor) return;
          const rect = anchor.getBoundingClientRect();
          const panel = panelRef.current;
          const width = panel ? panel.offsetWidth : 280;
          const height = panel ? panel.offsetHeight : 200;
          let left = rect.left;
          if (left + width > window.innerWidth - PANEL_MARGIN) left = window.innerWidth - PANEL_MARGIN - width;
          if (left < PANEL_MARGIN) left = PANEL_MARGIN;
          let top = rect.top - PANEL_GAP - height;
          if (top < PANEL_MARGIN) top = Math.min(window.innerHeight - PANEL_MARGIN - height, rect.bottom + PANEL_GAP);
          setPosition({ left: Math.round(left), top: Math.round(top) });
        };
        place();
        const frame = window.requestAnimationFrame(place);
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => {
          window.cancelAnimationFrame(frame);
          window.removeEventListener('resize', place);
          window.removeEventListener('scroll', place, true);
        };
      }, [open, rootRef, panelRef]);
      return position;
    }

    /** Close the card on Escape or a pointerdown outside both the trigger and the card. */
    function useDismiss(open, close, rootRef, panelRef) {
      React.useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
          const target = event.target;
          if (rootRef.current && rootRef.current.contains(target)) return;
          if (panelRef.current && panelRef.current.contains(target)) return;
          close();
        };
        const onKeyDown = (event) => {
          if (event.key === 'Escape') close();
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown);
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true);
          document.removeEventListener('keydown', onKeyDown);
        };
      }, [open, close, rootRef, panelRef]);
    }

    /**
     * The click-open detail card. Metrics (16px padding, 12px/18px type,
     * 76px label column, 6px/16px grid gaps, a 10px title rule) are copied
     * from the shipped stat-dialog card so it sits visually beside the
     * `Token 用量` and `会话统计` popovers.
     */
    function UsagePanel({ snapshot, phase, busy, t, onRefresh, panelRef, style }) {
      const ready = phase === 'ready' && snapshot && snapshot.ok === true;
      const fetched =
        snapshot && Number.isFinite(snapshot.fetchedAtMs) && snapshot.fetchedAtMs > 0
          ? new Date(snapshot.fetchedAtMs).toLocaleTimeString()
          : '';

      let headlinePercent = 0;
      let headlineKey = 'monthly';
      const rows = [];
      if (ready) {
        for (const key of WINDOW_KEYS) {
          const window = snapshot.windows?.[key];
          if (!window) continue;
          const percent = clampPercent(window.percent);
          const tone = toneOf(percent);
          if (percent >= headlinePercent) {
            headlinePercent = percent;
            headlineKey = key;
          }
          const resetMs = typeof window.resetsAt === 'string' ? Date.parse(window.resetsAt) : Number.NaN;
          const meta = Number.isFinite(resetMs)
            ? `${t('panel.resets')} ${formatRemaining(resetMs - Date.now(), t)} · ${formatResetClock(window.resetsAt)} ${t('panel.resetAt')}`
            : t('panel.noReset');
          rows.push(h('span', { key: `${key}-label`, className: 'ocgu_panel_dt' }, t(`tool.${key}`)));
          rows.push(
            h(
              'span',
              { key: `${key}-value`, className: 'ocgu_panel_dd', 'data-tone': tone },
              `${Math.round(percent * 10) / 10}%`,
            ),
          );
          rows.push(
            h(
              'div',
              { key: `${key}-bar`, className: 'ocgu_panel_bar', 'aria-hidden': true },
              h('span', { className: 'ocgu_panel_fill', 'data-tone': tone, style: { width: `${percent}%` } }),
            ),
          );
          rows.push(h('div', { key: `${key}-meta`, className: 'ocgu_panel_meta' }, meta));
        }
      }

      const status = ready ? null : phase === 'loading' ? t('loading') : errorText(snapshot, t);
      const message =
        !ready && snapshot && typeof snapshot.message === 'string' && snapshot.message !== '' ? snapshot.message : null;
      const sourceText = t(`panel.source.${snapshot?.source ?? 'none'}`);
      const headlineTone = toneOf(headlinePercent);

      return h(
        'div',
        {
          ref: panelRef,
          className: 'ocgu_panel',
          role: 'dialog',
          'aria-label': t('panel.title'),
          tabIndex: -1,
          style: style ?? { visibility: 'hidden', left: 0, top: 0 },
        },
        h(
          'div',
          { className: 'ocgu_panel_titleRow' },
          h(
            'span',
            { className: 'ocgu_panel_titleLabel' },
            h(
              'span',
              { className: 'ocgu_panel_titleIcon', 'aria-hidden': true },
              h(UsageRing, { percent: headlinePercent, tone: headlineTone }),
            ),
            h('span', { className: 'ocgu_panel_titleText' }, t('panel.title')),
          ),
          ready
            ? h(
                'span',
                { className: 'ocgu_panel_titleValue' },
                h('span', { className: 'ocgu_panel_titleValueLabel' }, t(`win.${headlineKey}`)),
                h(
                  'span',
                  { className: 'ocgu_panel_titleValuePercent', 'data-tone': headlineTone },
                  `${Math.round(headlinePercent * 10) / 10}%`,
                ),
              )
            : null,
        ),
        h('div', { className: 'ocgu_panel_titleRule' }),
        status !== null ? h('div', { className: 'ocgu_panel_status' }, status) : null,
        message !== null ? h('div', { className: 'ocgu_panel_message' }, message) : null,
        rows.length > 0 ? h('div', { className: 'ocgu_panel_details' }, rows) : null,
        snapshot?.useBalance === true ? h('div', { className: 'ocgu_panel_note' }, t('tool.balance')) : null,
        h(
          'div',
          { className: 'ocgu_panel_footer' },
          h(
            'div',
            { className: 'ocgu_panel_footerInfo' },
            h('div', { className: 'ocgu_panel_source' }, `${t('panel.source')}: ${sourceText}`),
            fetched !== ''
              ? h('div', { className: 'ocgu_panel_updated' }, `${t('tool.updated')} ${fetched}`)
              : null,
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'ocgu_panel_refresh',
              disabled: busy === true,
              onClick: onRefresh,
            },
            busy === true ? t('panel.refreshing') : t('panel.refresh'),
          ),
        ),
      );
    }

    /**
     * Poll the Host route; owned by the dock meter.
     *
     * A background poll never changes how the meter looks: `busy` is only set
     * for an explicit user refresh, and a failed poll keeps the last good
     * reading instead of blanking the pill, so nothing blinks on the 20s tick.
     */
    function useUsageSnapshot() {
      const [state, setState] = React.useState({ phase: 'loading', snapshot: null, busy: false });
      const busyRef = React.useRef(false);
      const aliveRef = React.useRef(true);

      /** A failed poll degrades silently while a good reading is on screen. */
      const degrade = React.useCallback((code) => {
        setState((previous) => {
          if (previous.snapshot && previous.snapshot.ok === true) return { ...previous, busy: false };
          return { phase: 'error', snapshot: { ok: false, code }, busy: false };
        });
      }, []);

      const load = React.useCallback(
        async (force) => {
          if (busyRef.current) return;
          busyRef.current = true;
          if (force) setState((previous) => ({ ...previous, busy: true }));
          try {
            const url = force ? `${ROUTE}?refresh=1` : ROUTE;
            const response = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json' } });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const payload = await response.json();
            const snapshot = payload && typeof payload === 'object' ? payload.snapshot : undefined;
            if (!aliveRef.current) return;
            if (!snapshot || typeof snapshot !== 'object') {
              degrade('unexpected_payload');
              return;
            }
            setState({ phase: 'ready', snapshot, busy: false });
          } catch {
            if (!aliveRef.current) return;
            degrade('host_unreachable');
          } finally {
            busyRef.current = false;
          }
        },
        [degrade],
      );

      React.useEffect(() => {
        aliveRef.current = true;
        void load(false);
        const timer = setInterval(() => {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
          void load(false);
        }, POLL_MS);
        const onVisibility = () => {
          if (typeof document !== 'undefined' && document.visibilityState === 'visible') void load(false);
        };
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
        return () => {
          aliveRef.current = false;
          clearInterval(timer);
          if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
        };
      }, [load]);

      return { state, load };
    }

    /** The compact meter itself. */
    function OpenCodeGoUsageMeter(props) {
      const t = React.useMemo(() => makeTranslator(props?.t), [props?.t]);
      const { state, load } = useUsageSnapshot();
      const [open, setOpen] = React.useState(false);
      const [, setTick] = React.useState(0);
      const rootRef = React.useRef(null);
      const panelRef = React.useRef(null);
      const close = React.useCallback(() => setOpen(false), []);

      // Keep the card's reset countdowns moving while it stays open.
      React.useEffect(() => {
        if (!open) return undefined;
        const timer = setInterval(() => setTick((value) => value + 1), 30000);
        return () => clearInterval(timer);
      }, [open]);

      // Move keyboard focus into the card so Escape and reading start there.
      React.useEffect(() => {
        if (!open || !panelRef.current) return;
        try {
          panelRef.current.focus({ preventScroll: true });
        } catch {
          panelRef.current.focus();
        }
      }, [open]);

      useDismiss(open, close, rootRef, panelRef);
      const position = useAnchoredPlacement(open, rootRef, panelRef);

      const snapshot = state.snapshot;
      const ready = state.phase === 'ready' && snapshot && snapshot.ok === true;
      const tone = ready
        ? toneOf(Math.max(...WINDOW_KEYS.map((key) => clampPercent(snapshot.windows?.[key]?.percent ?? 0))))
        : state.phase === 'loading'
          ? 'muted'
          : 'error';
      const tooltip = state.phase === 'loading' ? t('loading') : buildAriaLabel(snapshot, t);

      const segments = [];
      if (ready) {
        WINDOW_KEYS.forEach((key, index) => {
          const window = snapshot.windows?.[key];
          const percent = clampPercent(window?.percent ?? 0);
          const percentText = `${Math.round(percent * 10) / 10}%`;
          if (index > 0) segments.push(h('span', { key: `sep-${key}`, className: 'ocgu_sep', 'aria-hidden': true }, '·'));
          segments.push(
            h(
              'span',
              { key, className: 'ocgu_seg' },
              h('span', { className: 'ocgu_name' }, t(`win.${key}`)),
              h(UsageRing, { percent, tone: toneOf(percent) }),
              h('span', { className: 'ocgu_pct' }, percentText),
            ),
          );
        });
      }

      const content = ready
        ? segments
        : [h('span', { key: 'status', className: 'ocgu_status' }, state.phase === 'loading' ? '···' : t('error'))];

      const panel = open
        ? ReactDOM.createPortal(
            h(UsagePanel, {
              snapshot,
              phase: state.phase,
              busy: state.busy,
              t,
              panelRef,
              style: position,
              onRefresh: () => {
                void load(true);
              },
            }),
            document.body,
          )
        : null;

      return h(
        React.Fragment,
        null,
        h(
          'span',
          { ref: rootRef, className: 'ocgu_anchor', 'data-composer-stat': 'opencode-go' },
          h(
            'button',
            {
              type: 'button',
              className: 'ocgu_pill',
              'data-tone': tone,
              'aria-label': tooltip,
              'aria-haspopup': 'dialog',
              'aria-expanded': open,
              onClick: () => {
                const next = !open;
                setOpen(next);
                if (next) void load(false);
              },
            },
            h(
              'span',
              { className: 'ocgu_mark', 'aria-hidden': true },
              h('span', { className: 'ocgu_dot', 'data-tone': tone }),
              h('span', { className: 'ocgu_brand' }, t('brand')),
            ),
            content,
          ),
        ),
        panel,
      );
    }

    const CSS = `
.ocgu_anchor{min-width:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));display:inline-flex}
.ocgu_pill{box-sizing:border-box;border-radius:var(--dsw-radius-sm);max-width:100%;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap;background:0 0;border:none;align-items:center;gap:6px;padding:1px 8px;display:inline-flex;cursor:pointer}
.ocgu_pill:hover,.ocgu_pill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.ocgu_mark{align-items:center;gap:5px;display:inline-flex}
.ocgu_dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary);flex:none}
.ocgu_dot[data-tone=warn]{background:var(--dsw-alias-state-warn-primary)}
.ocgu_dot[data-tone=danger],.ocgu_dot[data-tone=error]{background:var(--dsw-alias-state-error-primary)}
.ocgu_dot[data-tone=muted]{background:var(--dsw-alias-label-tertiary)}
.ocgu_brand{font-weight:400;color:inherit;letter-spacing:.01em}
.ocgu_seg{align-items:center;gap:5px;display:inline-flex}
.ocgu_name{color:inherit}
.ocgu_ring{flex:none}
.ocgu_ring_track{fill:none;stroke:var(--dsw-alias-border-l3);stroke-width:2px}
.ocgu_ring_fill{fill:none;stroke:var(--dsw-alias-label-tertiary);stroke-width:2px;stroke-linecap:round;transition:stroke-dasharray .35s ease}
.ocgu_ring_fill[data-tone=warn]{stroke:var(--dsw-alias-state-warn-primary)}
.ocgu_ring_fill[data-tone=danger]{stroke:var(--dsw-alias-state-error-primary)}
.ocgu_pct{color:inherit}
.ocgu_sep{color:var(--dsw-alias-separator-primary);margin:0 2px}
.ocgu_status{color:var(--dsw-alias-label-tertiary)}
.ocgu_pill[data-tone=error]{color:var(--dsw-alias-state-error-primary)}
.ocgu_panel{position:fixed;z-index:1100;box-sizing:border-box;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);width:max-content;min-width:min(300px,100vw - 24px);max-width:min(440px,100vw - 24px);backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);cursor:default;border:0;padding:16px;font-size:12px;line-height:18px;outline:none}
.ocgu_panel_titleRow{align-items:center;justify-content:space-between;gap:16px;margin-bottom:8px;font-weight:500;color:var(--dsw-alias-label-primary);display:flex}
.ocgu_panel_titleLabel{align-items:center;gap:6px;min-width:0;display:inline-flex}
.ocgu_panel_titleIcon{display:inline-flex;flex:none;color:var(--dsw-alias-label-tertiary)}
.ocgu_panel_titleText{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ocgu_panel_titleValue{align-items:baseline;gap:4px;flex:none;display:inline-flex;font-variant-numeric:tabular-nums}
.ocgu_panel_titleValueLabel{color:var(--dsw-alias-label-tertiary);font-weight:400;font-size:11px}
.ocgu_panel_titleValuePercent{font-weight:500;font-variant-numeric:tabular-nums}
.ocgu_panel_titleValuePercent[data-tone=warn]{color:var(--dsw-alias-state-warn-primary)}
.ocgu_panel_titleValuePercent[data-tone=danger]{color:var(--dsw-alias-state-error-primary)}
.ocgu_panel_titleRule{border-top:1px solid var(--dsw-alias-border-l2);margin-bottom:10px}
.ocgu_panel_status{color:var(--dsw-alias-label-secondary)}
.ocgu_panel_message{color:var(--dsw-alias-label-tertiary);margin-top:2px;word-break:break-word}
.ocgu_panel_details{display:grid;grid-template-columns:minmax(76px,auto) minmax(0,1fr);gap:6px 16px;margin:0}
.ocgu_panel_dt{color:var(--dsw-alias-label-tertiary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ocgu_panel_dd{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right;min-width:0;font-weight:500}
.ocgu_panel_dd[data-tone=warn]{color:var(--dsw-alias-state-warn-primary)}
.ocgu_panel_dd[data-tone=danger]{color:var(--dsw-alias-state-error-primary)}
.ocgu_panel_bar{grid-column:1 / -1;height:4px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);overflow:hidden}
.ocgu_panel_fill{height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary);display:block;transition:width .35s ease}
.ocgu_panel_fill[data-tone=warn]{background:var(--dsw-alias-state-warn-primary)}
.ocgu_panel_fill[data-tone=danger]{background:var(--dsw-alias-state-error-primary)}
.ocgu_panel_meta{grid-column:1 / -1;color:var(--dsw-alias-label-tertiary);font-size:11px;font-variant-numeric:tabular-nums}
.ocgu_panel_note{color:var(--dsw-alias-label-tertiary);margin-top:12px;border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px}
.ocgu_panel_footer{align-items:flex-end;gap:8px;border-top:1px solid var(--dsw-alias-border-l2);margin-top:12px;padding-top:8px;display:flex}
.ocgu_panel_footerInfo{display:flex;flex-direction:column;min-width:0}
.ocgu_panel_source{color:var(--dsw-alias-label-tertiary);font-size:11px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ocgu_panel_updated{color:var(--dsw-alias-label-tertiary);font-size:11px;font-variant-numeric:tabular-nums;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ocgu_panel_refresh{margin-left:auto;box-sizing:border-box;border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);border:none;cursor:pointer;font:inherit;font-size:11px;padding:3px 10px;flex:none}
.ocgu_panel_refresh:hover{color:var(--dsw-alias-label-primary)}
.ocgu_panel_refresh:disabled{cursor:default;opacity:.6}
`;

    /** Register the meter in the composer dock and own its stylesheet. */
    function apply(ctx) {
      const locale = ctx.get('locale');
      if (locale && typeof locale.register === 'function') {
        try {
          ctx.effect(() => {
            const disposers = [];
            for (const localeId of Object.keys(DICT)) {
              try {
                disposers.push(locale.register(NS, localeId, DICT[localeId]));
              } catch {
                // A locale the deployment does not ship can be skipped.
              }
            }
            return () => {
              for (const dispose of disposers.reverse()) {
                try {
                  dispose();
                } catch {
                  // Disposal must not break teardown.
                }
              }
            };
          });
        } catch {
          // Localization is a refinement; the meter still renders with its fallback.
        }
      }

      ctx.effect(() => {
        const tag = document.createElement('style');
        tag.dataset.plugin = 'dsh-plugin-opencode-go-usage';
        tag.dataset.pluginCss = 'opencode-go-usage.css';
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return () => {
          tag.remove();
        };
      });

      ctx.slots.inject('conversation.composer.dock', () =>
        ctx.slots.register(
          {
            name: 'conversation.composer.dock',
            id: 'opencode-go-usage',
            order: 2,
            locale: NS,
          },
          OpenCodeGoUsageMeter,
        ),
      );
    }

    return {
      inject: ['slots'],
      apply,
    };
  },
});
