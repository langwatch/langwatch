# @langwatch/scenario-browser

The browser half of [scenario](../README.md). What a browser installs when it installs scenario: Agent Testing, the scenario library and the simulations pages, plus the drawers the address bar opens (`?drawer.open=<name>`) under the names the product already uses.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/scenario.web.ts:14` (`defineBrowserModule("scenario")`), exported as `scenarioWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                                      | URL                                             | Within | Label | Permission       | Flags |
| --------------------------------------------- | ----------------------------------------------- | ------ | ----- | ---------------- | ----- |
| `pages/[project]/agent-testing/[[...path]]`   | `/:project/agent-testing/*` (route table)       | –      | –     | –                | –     |
| `pages/[project]/simulations/scenarios/index` | `/:project/simulations/scenarios` (route table) | –      | –     | `scenarios:view` | –     |
| `pages/[project]/simulations/[[...path]]`     | `/:project/simulations` (route table)           | –      | –     | `scenarios:view` | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

| Drawer                    | Opens                                                                       | Opened from  |
| ------------------------- | --------------------------------------------------------------------------- | ------------ |
| `suiteEditor`             | `src/ui/sections/suites/suite-form-drawer.tsx`                              | –            |
| `scenarioEditor`          | `src/ui/sections/scenarios/scenario-form-drawer.tsx`                        | langy        |
| `scenarioRunDetail`       | `src/ui/sections/simulations/scenario-run-detail-drawer.tsx`                | agent, trace |
| `scenarioVersionHistory`  | `src/ui/sections/agent-testing/drawers/scenario-version-history-drawer.tsx` | –            |
| `agentTestingCaseEditor`  | `src/ui/sections/agent-testing/cases/agent-testing-case-editor-drawer.tsx`  | –            |
| `agentTestingSuiteEditor` | `src/ui/sections/agent-testing/drawers/suite-editor-drawer.tsx`             | –            |

Opened from lists the other modules (and `ui`, the app) whose browser source names the drawer in a
`…Drawer("<name>")` call, a `?drawer.open=<name>` link or by its token; a name held in a constant is not followed.

## Calls

- Client packages (package.json): `@langwatch/evaluator-client`, `@langwatch/feature-flag-client`, `@langwatch/model-provider-client`, `@langwatch/prompt-client`, `@langwatch/scenario-client`, `@langwatch/trace-client`.
- Lends: `MediaPartToken`, `ParameterLineFieldToken`, `TalkToItPanelToken`.
- Host APIs it requires: `ScenarioHostApi`.

<!-- readme:generated:end -->
