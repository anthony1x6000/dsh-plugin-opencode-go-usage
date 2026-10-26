# Changelog

## 1.0.0 — 2026-10-26

First public release.

- Composer-dock meter for the OpenCode Go subscription: rolling 5-hour, weekly
  and monthly windows rendered as small rings plus used percentages.
- Click-open detail card matching the shipped stat-dialog card metrics
  (16px padding, 12/18px type, 76px label column, 6/16px grid gaps, title rule).
- Settings-metrics detail rows with per-window quota progress bars and reset
  countdowns.
- Host half resolves the API key from plugin config, the Harness credential
  service (`OPENCODE_GO_API_KEY`), or OpenCode's own `auth.json`, then polls
  `https://opencode.ai/zen/go/v1/usage`. The key never reaches the browser.
- Same-origin JSON route with demand-driven refresh, in-flight coalescing and a
  minimum upstream interval; background polling is visually silent and a
  transient failure keeps the last good reading.
