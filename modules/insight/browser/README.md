# @langwatch/insight-browser

The browser half of [insight](../README.md). What a browser installs when it installs insight: the inbox screen behind `release_insights`, and what it lends the shell and a board's header (the bell, the side-menu entry's rule and count, and "Daily insights"). Everything but the entry's rule loads lazily.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/insight.web.ts:24` (`defineBrowserModule("insight")`), exported as `insightWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                   | URL                  | Within  | Label    | Permission       | Flags                                                                    |
| -------------------------- | -------------------- | ------- | -------- | ---------------- | ------------------------------------------------------------------------ |
| `pages/[project]/insights` | `/:project/insights` | project | Insights | `analytics:view` | ≈ `FrontendFlags.release_insights`, ≈ `FrontendFlags.release_dashboards` |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

None.

## Calls

- `withApi(insightApi)`, tRPC contracts: `insights.*`.
- Client packages (package.json): `@langwatch/analytics-client`, `@langwatch/langy-client`.
- Lends: `InsightsBellToken`, `InsightsEntryToken`, `InsightsNavCountToken`, `BoardHeaderActionToken`.
- Host APIs it requires: `InsightHostApi`.

<!-- readme:generated:end -->
