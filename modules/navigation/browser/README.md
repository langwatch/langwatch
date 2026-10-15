# @langwatch/navigation-browser

The browser half of [navigation](../README.md). What a browser installs when it installs navigation: the addresses that belong to no one feature - the landing redirect, the 404 every unmatched address falls to, and the `@project` forward the old parallel route minted.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/navigation.web.ts:14` (`defineBrowserModule("navigation")`), exported as `navigationWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                         | URL                         | Within | Label | Permission | Flags |
| -------------------------------- | --------------------------- | ------ | ----- | ---------- | ----- |
| `pages/index`                    | `/` (route table)           | –      | –     | –          | –     |
| `pages/not-found`                | `/*` (route table)          | –      | –     | –          | –     |
| `pages/settings/not-found`       | `/settings/*` (route table) | –      | –     | –          | –     |
| `pages/@project/[...path]/index` | `/@project/*` (route table) | –      | –     | –          | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

None.

## Calls

- `withApi(navigationApi)`, tRPC contracts: `featureFlag.*`.
- Client packages (package.json): `@langwatch/analytics-client`, `@langwatch/dataset-client`, `@langwatch/evaluator-client`, `@langwatch/feature-flag-client`, `@langwatch/navigation-client`, `@langwatch/organization-client`, `@langwatch/prompt-client`.
- Lends: `SidebarToken`, `InlineCommandPaletteToken`.
- Capabilities: `host`, `chrome`, `commandBar`.

<!-- readme:generated:end -->
