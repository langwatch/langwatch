# @langwatch/analytics-browser

The browser half of [analytics](../README.md). What a browser installs when it installs analytics: the drawers the address bar opens (`?drawer.open=<name>`). Both wrappers were renamed Drawer -> Dialog on this branch; the wire name did not change.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/analytics.web.ts:31` (`defineBrowserModule("analytics")`), exported as `analyticsWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                                          | URL                                                      | Within | Label | Permission       | Flags |
| ------------------------------------------------- | -------------------------------------------------------- | ------ | ----- | ---------------- | ----- |
| `pages/[project]/analytics/index`                 | `/:project/analytics` (route table)                      | –      | –     | `analytics:view` | –     |
| `pages/[project]/analytics/evaluations`           | `/:project/analytics/evaluations` (route table)          | –      | –     | `analytics:view` | –     |
| `pages/[project]/analytics/metrics`               | `/:project/analytics/metrics` (route table)              | –      | –     | `analytics:view` | –     |
| `pages/[project]/analytics/reports`               | `/:project/analytics/reports` (route table)              | –      | –     | `analytics:view` | –     |
| `pages/[project]/analytics/topics`                | `/:project/analytics/topics` (route table)               | –      | –     | `analytics:view` | –     |
| `pages/[project]/analytics/users`                 | `/:project/analytics/users` (route table)                | –      | –     | `analytics:view` | –     |
| `pages/[project]/analytics/custom/index`          | `/:project/analytics/custom` (route table)               | –      | –     | `analytics:view` | –     |
| `pages/[project]/analytics/custom/[id]`           | `/:project/analytics/custom/:id` (route table)           | –      | –     | `analytics:view` | –     |
| `pages/[project]/dashboards/index`                | `/:project/dashboards` (route table)                     | –      | –     | –                | –     |
| `pages/[project]/dashboards/templates`            | `/:project/dashboards/templates` (route table)           | –      | –     | –                | –     |
| `pages/[project]/dashboards/curated/[templateId]` | `/:project/dashboards/curated/:templateId` (route table) | –      | –     | –                | –     |
| `pages/[project]/dashboards/[dashboardId]`        | `/:project/dashboards/:dashboardId` (route table)        | –      | –     | –                | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

| Drawer          | Opens                                       | Opened from |
| --------------- | ------------------------------------------- | ----------- |
| `dashboardName` | `src/ui/sections/dashboard-name-dialog.tsx` | –           |
| `seriesFilters` | `src/ui/sections/series-filters-dialog.tsx` | –           |

Opened from lists the other modules (and `ui`, the app) whose browser source names the drawer in a
`…Drawer("<name>")` call, a `?drawer.open=<name>` link or by its token; a name held in a constant is not followed.

## Calls

- `withApi(analyticsApi)`, tRPC contracts: `analytics.*`, `analytics.lwql.*`, `savedViews.*`.
- Client packages (package.json): `@langwatch/analytics-client`, `@langwatch/feature-flag-client`, `@langwatch/langy-client`.
- Lends: `SavedDashboardsToken`, `StarredDashboardsToken`, `FilterSidebarToken`, `CustomGraphToken`.
- Host APIs it requires: `AnalyticsHostApi`.
- Capabilities: `traceFilters`.

<!-- readme:generated:end -->
