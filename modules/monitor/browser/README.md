# @langwatch/monitor-browser

The browser half of [monitor](../README.md). What a browser installs when it installs monitor: the online-evaluations screen a project runs over its live traces and threads.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/monitor.web.ts:8` (`defineBrowserModule("monitor")`), exported as `monitorWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                             | URL                            | Within  | Label              | Permission         | Flags |
| ------------------------------------ | ------------------------------ | ------- | ------------------ | ------------------ | ----- |
| `pages/[project]/online-evaluations` | `/:project/online-evaluations` | project | Online Evaluations | `evaluations:view` | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

None.

## Calls

- Host APIs it requires: `MonitorHostApi`.

<!-- readme:generated:end -->
