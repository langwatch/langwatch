# @langwatch/trace-browser

The browser half of [trace](../README.md). What a browser installs when it installs trace: the Trace Explorer, the public share page, and the drawers the address bar opens (`?drawer.open=<name>`) under the names the product has always used.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/trace.web.ts:24` (`defineBrowserModule("trace")`), exported as `traceWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                 | URL                              | Within | Label | Permission    | Flags |
| ------------------------ | -------------------------------- | ------ | ----- | ------------- | ----- |
| `pages/[project]/traces` | `/:project/traces` (route table) | –      | –     | `traces:view` | –     |
| `pages/share/[id]`       | `/share/:id` (route table)       | –      | –     | –             | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

| Drawer             | Opens                                                    | Opened from                                           |
| ------------------ | -------------------------------------------------------- | ----------------------------------------------------- |
| `traceV2Details`   | `src/ui/sections/explorer/trace-v2-details-drawer.tsx`   | evaluator, experiment, navigation, scenario, workflow |
| `addDatasetRecord` | `src/ui/sections/datasets/add-dataset-record-drawer.tsx` | annotation                                            |
| `traceDetails`     | `src/ui/sections/legacy-trace-drawer-redirect.tsx`       | –                                                     |

Opened from lists the other modules (and `ui`, the app) whose browser source names the drawer in a
`…Drawer("<name>")` call, a `?drawer.open=<name>` link or by its token; a name held in a constant is not followed.

## Calls

- Client packages (package.json): `@langwatch/annotation-client`, `@langwatch/api-key-client`, `@langwatch/dataset-client`, `@langwatch/evaluator-client`, `@langwatch/feature-flag-client`, `@langwatch/onboarding-client`, `@langwatch/prompt-client`, `@langwatch/scenario-client`, `@langwatch/trace-client`.
- Lends: `AgentActionsMenuToken`, `EvaluatorTracesMappingToken`, `ConversationThreadToken`, `TracePreviewHoverCardToken`, `RenderInputOutputToken`, `TraceIdPeekToken`, `SetupWithAgentButtonToken`, `AnnotationQueueConversationToken`, `TraceEditButtonToken`.
- Host APIs it requires: `TraceHostApi`.
- Capabilities: `presenceMenuItem`.

<!-- readme:generated:end -->
