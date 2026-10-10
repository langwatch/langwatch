# @langwatch/experiment-browser

The browser half of [experiment](../README.md). What a browser installs when it installs experiment: the drawers the address bar opens (`?drawer.open=<name>`), under the names the product has always used.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/experiment.web.ts:19` (`defineBrowserModule("experiment")`), exported as `experimentWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                                       | URL                                                   | Within | Label | Permission         | Flags |
| ---------------------------------------------- | ----------------------------------------------------- | ------ | ----- | ------------------ | ----- |
| `pages/[project]/experiments/index`            | `/:project/experiments` (route table)                 | –      | –     | `experiments:view` | –     |
| `pages/[project]/experiments/workbench/index`  | `/:project/experiments/workbench` (route table)       | –      | –     | –                  | –     |
| `pages/[project]/experiments/workbench/[slug]` | `/:project/experiments/workbench/:slug` (route table) | –      | –     | –                  | –     |
| `pages/[project]/experiments/[experiment]`     | `/:project/experiments/:experiment` (route table)     | –      | –     | –                  | –     |
| `pages/[project]/evaluations/wizard/[slug]`    | `/:project/evaluations/wizard/:slug` (route table)    | –      | –     | –                  | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

| Drawer                  | Opens                                                             | Opened from |
| ----------------------- | ----------------------------------------------------------------- | ----------- |
| `comparisonLeaderboard` | `src/ui/sections/batch-results/comparison-leaderboard-drawer.tsx` | –           |
| `targetTypeSelector`    | `src/ui/sections/experiments-v3/target-type-selector-drawer.tsx`  | –           |

Opened from lists the other modules (and `ui`, the app) whose browser source names the drawer in a
`…Drawer("<name>")` call, a `?drawer.open=<name>` link or by its token; a name held in a constant is not followed.

## Calls

- `withApi(experimentApi)`, tRPC contracts: `experiments.*`, `agents.*`, `prompts.*`, `evaluators.*`, `evaluations.*`, `dataset.*`, `datasetRecord.*`, `batchRecord.*`, `ops.*`.
- Client packages (package.json): `@langwatch/dataset-client`, `@langwatch/evaluator-client`, `@langwatch/experiment-client`, `@langwatch/feature-flag-client`, `@langwatch/prompt-client`, `@langwatch/trace-client`, `@langwatch/workflow-client`.
- Lends: `ComparisonConfigFormToken`.
- Host APIs it requires: `WorkflowHostApi`.

<!-- readme:generated:end -->
