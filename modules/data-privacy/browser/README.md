# @langwatch/data-privacy-browser

The browser half of [data-privacy](../README.md). What a browser installs when it installs data-privacy: the redaction rules screen.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/data-privacy.web.ts:8` (`defineBrowserModule("data-privacy")`), exported as `dataPrivacyWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                      | URL                      | Within   | Label        | Permission     | Flags |
| ----------------------------- | ------------------------ | -------- | ------------ | -------------- | ----- |
| `pages/settings/data-privacy` | `/settings/data-privacy` | settings | Data Privacy | `project:view` | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

None.

## Calls

- Host APIs it requires: `DataPrivacyHostApi`.

<!-- readme:generated:end -->
