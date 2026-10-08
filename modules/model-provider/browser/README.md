# @langwatch/model-provider-browser

The browser half of [model-provider](../README.md). What a browser installs when it installs model-provider: the Model Providers and Model Costs settings screens, their three drawers, and the surfaces evaluator, langy and trace mount today.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/model-provider.web.ts:18` (`defineBrowserModule("model-provider")`), exported as `modelProviderWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                         | URL                         | Within   | Label           | Permission | Flags |
| -------------------------------- | --------------------------- | -------- | --------------- | ---------- | ----- |
| `pages/settings/model-providers` | `/settings/model-providers` | settings | Model Providers | –          | –     |
| `pages/settings/model-costs`     | `/settings/model-costs`     | settings | Model Costs     | –          | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

| Drawer                 | Opens                                               | Opened from |
| ---------------------- | --------------------------------------------------- | ----------- |
| `editModelProvider`    | `src/ui/sections/edit-model-provider-drawer.tsx`    | –           |
| `defaultModelOverride` | `src/ui/sections/default-model-override-drawer.tsx` | –           |
| `llmModelCost`         | `src/ui/sections/llm-model-cost-drawer.tsx`         | –           |

Opened from lists the other modules (and `ui`, the app) whose browser source names the drawer in a
`…Drawer("<name>")` call, a `?drawer.open=<name>` link or by its token; a name held in a constant is not followed.

## Calls

- `withApi(modelProviderApi)`, tRPC contracts: `modelProvider.*`.
- Client packages (package.json): `@langwatch/enterprise-managed-provider-client`, `@langwatch/model-provider-client`.
- Lends: `EditModelProviderFormToken`, `ModelDisplayToken`, `ModelSelectorToken`.
- Host APIs it requires: `ModelProviderHostApi`.

<!-- readme:generated:end -->
