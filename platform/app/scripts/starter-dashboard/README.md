# Starter dashboard seed

One-shot script that populates an **"Analytics starter"** dashboard with 8
widgets pulled from the `north-star-widgets` and `legacy-parity-widgets`
packs, so a new project gets a useful dashboard without opening the UI.

## Env vars

| Var | Meaning |
|---|---|
| `LW_ENDPOINT` | Base URL of the LangWatch app, e.g. `https://app.langwatch.ai` |
| `LW_API_KEY` | Project API key, sent as the `X-Auth-Token` header |
| `PROJECT_ID` | Target project id (used only for the widget routes; dashboard routes resolve the project from `LW_API_KEY`) |

## Usage

```
LW_ENDPOINT=https://app.langwatch.ai LW_API_KEY=sk-... PROJECT_ID=proj_... \
  node platform/app/scripts/starter-dashboard/seed.mjs
```

## Manifest (order = layout)

Pins land at the dashboard's next free row, single column — so the manifest
order below is literally the widget's top-to-bottom order on the dashboard.

| # | Pack | File |
|---|---|---|
| 1 | north-star-widgets | north-star-metric-stat.json |
| 2 | north-star-widgets | north-star-area-timeseries.json |
| 3 | north-star-widgets | north-star-stacked-bars.json |
| 4 | legacy-parity-widgets | legacy-trace-count-over-time.json |
| 5 | north-star-widgets | north-star-donut.json |
| 6 | north-star-widgets | north-star-leaderboard.json |
| 7 | north-star-widgets | north-star-heatmap.json |
| 8 | legacy-parity-widgets | legacy-latency-percentiles.json |

**Prototype note:** this is single-column only. Every widget gets
`gridColumn = 0`, so widgets share the gridRow numbering line and just
stack vertically — no side-by-side layout. Good enough for a one-shot
starter board, not a real layout tool.

## Idempotency

Re-running the script is safe:
- Dashboard: skipped if a dashboard named "Analytics starter" already exists.
- Widgets: skipped if a widget with the same `name` already exists.
- Pins: skipped if the widget's `dashboardId` already matches this dashboard.

No duplicates are created on a re-run.

## Pin semantics

Pinning a widget to a dashboard does **not** move it: the widget's
`dashboardId` is set and it renders on the dashboard, but it stays fully
visible and editable on the custom-chart playground too — the widget now
has a second home. There is no "create straight onto a dashboard" — the
widget-create route deliberately sets no `dashboardId` (a playground widget
lives on the playground page until pinned), so pin-reuse of the pack
seeders' widgets is the simple path here.

Note the pack seeders create by name-not-found, so if this script already
pinned e.g. "North-star: Metric" onto the dashboard, re-running the pack
seeder will NOT create a fresh copy under the same name (name already
exists) — you'd need to rename or delete first.

## Verify

Open the dashboard's `platformUrl` (printed at the end of the run, or from
`GET /api/dashboards`) and confirm it shows 8 populated widgets in the
manifest order above.
