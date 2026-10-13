# @langwatch/integration-browser

The browser half of [integration](../README.md). What a browser installs for integration: the Integrations screen and its GitHub host.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/integration.web.ts:5` (`defineBrowserModule("integration")`), exported as `integrationWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                      | URL                      | Within   | Label        | Permission          | Flags |
| ----------------------------- | ------------------------ | -------- | ------------ | ------------------- | ----- |
| `pages/settings/integrations` | `/settings/integrations` | settings | Integrations | `organization:view` | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

None.

## Calls

- Host APIs it requires: `GithubHostApi`.

<!-- readme:generated:end -->
