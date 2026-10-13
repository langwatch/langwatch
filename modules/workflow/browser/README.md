# @langwatch/workflow-browser

The browser half of [workflow](../README.md). What a browser installs when it installs workflow: the workflow list, the Optimization Studio, and the workflow chat.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/workflow.web.ts:17` (`defineBrowserModule("workflow")`), exported as `workflowWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                            | URL                                        | Within | Label | Permission       | Flags |
| ----------------------------------- | ------------------------------------------ | ------ | ----- | ---------------- | ----- |
| `pages/[project]/workflows`         | `/:project/workflows` (route table)        | –      | –     | `workflows:view` | –     |
| `pages/[project]/studio/[workflow]` | `/:project/studio/:workflow` (route table) | –      | –     | –                | –     |
| `pages/[project]/chat/[workflow]`   | `/:project/chat/:workflow` (route table)   | –      | –     | –                | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

None.

## Calls

- `withApi(workflowApi)`, tRPC contracts: `workflow.*`, `optimization.*`.
- Client packages (package.json): `@langwatch/agent-client`, `@langwatch/api-key-client`, `@langwatch/dataset-client`, `@langwatch/evaluator-client`, `@langwatch/model-provider-client`, `@langwatch/monitor-client`, `@langwatch/prompt-client`, `@langwatch/scenario-client`, `@langwatch/trace-client`, `@langwatch/workflow-client`.
- Lends: `HoverableBigTextToken`, `RedactedFieldToken`, `VersionBoxToken`, `RunExperimentViaApiDialogToken`.
- Host APIs it requires: `WorkflowHostApi`.

<!-- readme:generated:end -->
