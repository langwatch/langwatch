# @langwatch/enterprise-licensing-browser

The browser half of [licensing](../README.md). What a browser installs when it installs licensing: the License settings screen, the usage-against-limit row billing and organization borrow, and the reader that opens the upgrade modal on any licence refusal. Always installed.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/licensing.web.ts:11` (`defineBrowserModule("licensing")`), exported as `licensingWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                 | URL                 | Within   | Label   | Permission | Flags |
| ------------------------ | ------------------- | -------- | ------- | ---------- | ----- |
| `pages/settings/license` | `/settings/license` | settings | License | –          | –     |
| `pages/settings/connect` | `/settings/connect` | settings | Connect | –          | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

None.

## Calls

- Host APIs it requires: `LicensingHostApi`.
- Capabilities: `resourceLimitRow`.

<!-- readme:generated:end -->
