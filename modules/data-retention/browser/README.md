# @langwatch/data-retention-browser

The browser half of [data-retention](../README.md). What a browser installs when it installs data-retention: the retention schedule screen.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/data-retention.web.ts:8` (`defineBrowserModule("data-retention")`), exported as `dataRetentionWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                        | URL                        | Within   | Label          | Permission     | Flags |
| ------------------------------- | -------------------------- | -------- | -------------- | -------------- | ----- |
| `pages/settings/data-retention` | `/settings/data-retention` | settings | Data Retention | `project:view` | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

None.

## Calls

- Host APIs it requires: `DataRetentionHostApi`.

<!-- readme:generated:end -->
