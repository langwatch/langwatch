# @langwatch/evaluator-browser

The browser half of [evaluator](../README.md). What a browser installs when it installs evaluator: the drawers the address bar opens (`?drawer.open=<name>`), under the names the product has always used. Its screens join this declaration in the declarations fan-out.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/evaluator.web.ts:17` (`defineBrowserModule("evaluator")`), exported as `evaluatorWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                                       | URL                                                   | Within | Label | Permission         | Flags |
| ---------------------------------------------- | ----------------------------------------------------- | ------ | ----- | ------------------ | ----- |
| `pages/[project]/evaluators`                   | `/:project/evaluators` (route table)                  | –      | –     | `evaluations:view` | –     |
| `pages/[project]/evaluations/[id]/edit`        | `/:project/evaluations/:id/edit` (route table)        | –      | –     | –                  | –     |
| `pages/[project]/evaluations/[id]/edit/choose` | `/:project/evaluations/:id/edit/choose` (route table) | –      | –     | –                  | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

| Drawer                         | Opens                                                                   | Opened from                                    |
| ------------------------------ | ----------------------------------------------------------------------- | ---------------------------------------------- |
| `evaluatorList`                | `src/ui/sections/evaluator-list-drawer.tsx`                             | experiment, scenario                           |
| `evaluatorCategorySelector`    | `src/ui/sections/evaluators/evaluator-category-selector-drawer.tsx`     | navigation, workflow                           |
| `evaluatorEditor`              | `src/ui/sections/evaluators/evaluator-editor-drawer.tsx`                | experiment, langy, navigation, scenario, trace |
| `codeEvaluatorEditor`          | `src/ui/sections/evaluators/code-evaluator-editor-drawer.tsx`           | experiment, scenario                           |
| `workflowSelectorForEvaluator` | `src/ui/sections/evaluators/workflow-selector-for-evaluator-drawer.tsx` | –                                              |
| `evaluatorHistory`             | `src/ui/sections/evaluator-history-panel.tsx`                           | –                                              |
| `onlineEvaluation`             | `src/ui/sections/evaluations/online-evaluation-drawer.tsx`              | langy, trace                                   |
| `guardrails`                   | `src/ui/sections/evaluations/guardrails-drawer.tsx`                     | –                                              |

Opened from lists the other modules (and `ui`, the app) whose browser source names the drawer in a
`…Drawer("<name>")` call, a `?drawer.open=<name>` link or by its token; a name held in a constant is not followed.

## Calls

- `withApi(evaluatorApi)`, tRPC contracts: `evaluators.*`.
- Client packages (package.json): `@langwatch/analytics-client`, `@langwatch/api-key-client`, `@langwatch/evaluator-client`, `@langwatch/experiment-client`, `@langwatch/model-provider-client`, `@langwatch/prompt-client`, `@langwatch/trace-client`, `@langwatch/workflow-client`.
- Lends: `StudioEvaluatorEditorToken`, `EvaluatorSettingsFormToken`.
- Host APIs it requires: `EvaluatorHostApi`.
- Config slices: `evaluation`.

<!-- readme:generated:end -->
