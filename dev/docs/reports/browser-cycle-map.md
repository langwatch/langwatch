# The browser cycle: what has to move to delete the shared declarations project

**Status: map only. No source, tsconfig or `dev/tsconfig.web-declarations.json` was changed producing this.**
Measured 2026-09-18, after the `createServerApp` removal landed.

## The two numbers

| | |
|---|---|
| packages in the cycle | **9** |
| package→package edges inside it | **30** |
| import statements on those edges | **157** |
| **edges that must move to break it** | **7** |
| **import statements those 7 touch** | **18** |

Breaking the cycle is a **7-edge, 18-statement change across 12 files**, not a 30-edge one.
The other 23 edges already point the right way down a valid layering and can stay exactly where they are.

A valid layering (each package may only import those above it):

```
agent-browser  <  scenario-browser  <  evaluator-browser  <  analytics-browser
               <  prompt-browser    <  experiment-browser <  workflow-browser
               <  trace-browser     <  prompt-browser-kit
```

## Why this matters

Because these nine packages import each other in a ring, they cannot be separate TypeScript
projects — project references must be acyclic. The escape was to merge them: **15 browser
packages' `tsconfig.build.json` are stubs (`"files": []`) that reference one shared project**,
`dev/tsconfig.web-declarations.json`.

Measured cost of that shared project, today:

| | |
|---|---|
| files in the program | 8,542 |
| types | 1,278,596 |
| type instantiations | **6,952,827** |
| check time | **7.75s** |
| peak RSS | **3.56 GiB** |

It is now the **most expensive single project in the solution.** Before the `createServerApp`
removal it measured 15.3s, but instantiations barely moved (7,063,629 → 6,952,827, −1.6%) —
that project never compiled the server chain, so the earlier figure was contention-inflated.
**7.75s / 6.95M is the honest number.** For comparison, `apps/ui/tsconfig.test.json` now checks
in 1.875s and every other project in the 214-project sweep is under 2.4s.

Two consequences beyond the time:

- **Declaration granularity is 15 packages, not one.** Any change in any of them re-emits all 15.
- **One error freezes all fifteen.** Confirmed live: a single `TS2353` in
  `modules/experiment/browser/src/ui/sections/experiments-v3/TargetSection/target-header.tsx:268`
  blocked emit for hours, leaving every browser package's published declarations stale while
  downstream checks read them. At the time of writing the project reports 3 errors in 3 files.

## The minimum cut — where each of the 7 goes

Destinations are checked against the kit law (ARCHITECTURE.md §"The kit law", rules 1–6).
**Rule 6 is what makes most of these cheap:** the three-consumer floor gates a kit's
*existence*, not its contents — an already-existing kit may hold a one-consumer symbol.

| # | edge | stmts | destination | kit law |
|---|---|---|---|---|
| 1 | `workflow-browser` → `prompt-browser` | 6 | **`prompt-browser-kit`** (exists, 6 consumers) | ✅ rule 6 |
| 2 | `workflow-browser` → `evaluator-browser` | 4 | **`evaluator-browser-kit`** (exists, 2 consumers) | ✅ rule 6 |
| 3 | `workflow-browser` → `experiment-browser` | 2 | **`experiment-browser-kit`** (exists, 2 consumers) | ✅ rule 6 |
| 4 | `trace-browser` → `evaluator-browser` | 2 | **`evaluator-browser-kit`** (exists) | ✅ rule 6 |
| 5 | `trace-browser` → `scenario-browser` | 2 | **`trace-browser-kit`** (exists, 6 consumers) — invert ownership | ✅ rule 6, see note |
| 6 | `prompt-browser-kit` → `workflow-browser` | 1 | **`@langwatch/workflow-contract`** | ✅ rule 2 |
| 7 | `workflow-browser` → `agent-browser` | 1 | **open — rule 5 refuses a kit here** | ⚠️ needs a ruling |

### Per-edge detail

**1. `workflow-browser` → `prompt-browser` (6 statements, 4 files)**
`nodeDataToLocalPromptConfig`, `PromptEditorDrawer`, `OutputsSection`, `CODE_OUTPUT_TYPES`,
`Output`, `OutputType`, `LLMConfigField`. `prompt-browser-kit` already exists with six
consumers and already holds this family's neighbours (`FieldMapping`, `LLMModelDisplay`,
`getMaxTokenLimit`). Straight move.

**2 & 4. → `evaluator-browser` (4 + 2 statements)**
From workflow: `useAvailableEvaluators`, `DynamicZodForm`, `EvaluatorEditorContent`,
`EvaluatorMappingsConfig`. From trace: `evaluationPassed`, `evaluationStatusColor` — two pure
functions in `modules/evaluator/browser/src/model/evaluation-status.ts:12,24` over an
`EvaluationVerdictReading`. Ideal kit material (rule 3: presentational/pure, fetches nothing).
`evaluator-browser-kit` exists; moving these takes it from 2 consumers to 3, which also clears
it past the default floor.

**3. `workflow-browser` → `experiment-browser` (2 statements, 1 file)**
`useBatchEvaluationState`, `BatchEvaluationResultsTable`, `BatchRunSummary`, `BatchRunsSidebar`,
`BatchSummaryFooter`, `transformBatchEvaluationData` — all in
`optimization_studio/results-panel.tsx`. `experiment-browser-kit` exists (2 consumers → 3).
Check rule 3 on `useBatchEvaluationState`: if it runs its own query it must be split, with the
kit taking data as props and each consumer wiring its own fetch (the model-selector ruling).

**5. `trace-browser` → `scenario-browser` (2 statements) — ownership inversion**
`MediaProbeResult`, `MediaPart` (imported as `SimulationMediaPart`), `MediaPartProps`.
`scenario-browser-kit` does **not** exist and this is its only external consumer, so rule 5
refuses to mint one. The cheap legal move is the other direction: put the media-part component
and its types in **`trace-browser-kit`** (exists, 6 consumers, rule 6 applies) and have
`scenario-browser` import them from there. Note `trace-contract` already carries the normalised
shape (`NormalizedMediaPart`, `inlineDataToMediaPart` in
`trace-content-part.provider-source.ts:48`), so the *types* may belong in the contract and only
the component in the kit.

**6. `prompt-browser-kit` → `workflow-browser` (1 statement) — the outright law breach**
`exampleParameterValue`, a pure function at
`modules/workflow/browser/src/model/evaluate-api-snippet.ts:15` (`(type: string) => string |
number | boolean | undefined`). A kit importing a `*-browser` is a direct rule 2 violation.
**`workflow-browser-kit` is not a legal destination either — rule 2 forbids a kit importing
another kit.** The legal home is a contract, and `prompt-browser-kit` already depends on
`@langwatch/workflow-contract`. Move it there; `workflow-browser`'s own three call sites
(`evaluate-api-snippet.ts:48`, `run-via-api/run-snippets.ts:57`, plus its unit test) follow.

> Worth flagging separately: `prompt-browser-kit`'s manifest **already** declares
> `@langwatch/workflow-browser-kit` and `@langwatch/model-provider-browser`. Both are rule 2
> violations independent of this cycle, and neither is in the minimum cut. They should be swept
> in the same pass or they will re-open the door.

**7. `workflow-browser` → `agent-browser` (1 statement) — needs a ruling**
`modules/workflow/browser/src/behavior/agents/http/index.ts:6` re-exports nineteen symbols —
`HttpConfigEditor`, `AuthConfigSection`, `BodyTemplateEditor`, `HeadersConfigSection`,
`HttpMethodSelector`, `HttpTestPanel` and their prop types. `agent-browser` genuinely owns and
renders them (`src/ui/sections/http-config-editor.tsx`, `ui/elements/http-auth-config-section.tsx`,
`ui/sections/agent-http-editor-tabs.tsx`, `src/agent-http-editor.ts`).

I checked whether a third consumer exists to justify `agent-browser-kit`: **it does not.**
`analytics-browser` appeared in a first grep only because
`dashboard-widget-edit-drawer.tsx:141` mentions the path `components/agents/http/HttpConfigEditor.tsx`
**in a comment**. Workflow is the sole external consumer, so rule 5 refuses to mint a kit
("one consumer is not enough to MINT a kit: that is bilateral coupling, and the answer is to
inline or duplicate it").

Three options, none free:
- **(a) Follow rule 5 literally** — duplicate the editor family into `workflow-browser`.
  Nineteen symbols across four source files is a large surface to copy; this is the case rule 5's
  2026-09-18 amendment was written about, except that amendment needs *two* consumers and there is one.
- **(b) Mint `agent-browser-kit` anyway** and record the exception in the record, as `suite` was.
- **(c) Invert**: `agent-browser` declares the editor through its `./declaration`
  `withCapabilities` slot and `workflow-browser` consumes the capability rather than the components.
  This is the shape the architecture already prescribes for cross-module browser needs, and it is
  the only one of the three that removes the edge without either copying or a new package.

Note the wrapper is not a pure re-export: it pulls `@langwatch/browser-trpc/workflow-api` and
`useOrganizationTeamProject`, so whatever moves, **rule 3 forbids the fetching half landing in a kit.**


## Every edge, with file:line

### The minimum cut — 7 edges, 18 import statements

| edge | stmts | kind | symbols | files (`file:line`) |
|---|---|---|---|---|
| `workflow-browser` → `agent-browser` | 1 | value | AuthConfigSection, AuthConfigSectionProps, BodyTemplateEditor, BodyTemplateEditorProps, HeadersConfigSection, HeadersConfigSectionProps, +13 | `modules/workflow/browser/src/behavior/agents/http/index.ts:6` |
| `prompt-browser-kit` → `workflow-browser` | 1 | value | exampleParameterValue | `modules/prompt/browser-kit/src/ui/sections/api-snippet/get-prompt-snippets.ts:2` |
| `trace-browser` → `scenario-browser` | 2 | mixed | MediaProbeResult, MediaPart, MediaPartProps | `modules/trace/browser/src/behavior/trace-api.ts:29`<br>`modules/trace/browser/src/ui/sections/simulations/media-part.tsx:1` |
| `trace-browser` → `evaluator-browser` | 2 | value | evaluationPassed, evaluationStatusColor | `modules/trace/browser/src/ui/sections/traces/evaluation-status-item.tsx:5`<br>`modules/trace/browser/src/ui/sections/traces/span-details.tsx:5` |
| `workflow-browser` → `experiment-browser` | 2 | value | useBatchEvaluationState, BatchEvaluationResultsTable, BatchRunSummary, BatchRunsSidebar, BatchSummaryFooter, transformBatchEvaluationData | `modules/workflow/browser/src/ui/sections/optimization_studio/results-panel.tsx:8`<br>`modules/workflow/browser/src/ui/sections/optimization_studio/results-panel.tsx:9` |
| `workflow-browser` → `evaluator-browser` | 4 | mixed | useAvailableEvaluators, DynamicZodForm, EvaluatorEditorContent, EvaluatorMappingsConfig | `modules/workflow/browser/src/ui/sections/optimization_studio/properties/evaluator-properties-panel.tsx:3`<br>`modules/workflow/browser/src/ui/sections/optimization_studio/properties/evaluator-properties-panel.tsx:4`<br>`modules/workflow/browser/src/ui/sections/optimization_studio/properties/evaluator-properties-panel.tsx:5`<br>`modules/workflow/browser/src/ui/sections/optimization_studio/properties/evaluator-properties-panel.tsx:6` |
| `workflow-browser` → `prompt-browser` | 6 | mixed | nodeDataToLocalPromptConfig, PromptEditorDrawer, OutputsSection, CODE_OUTPUT_TYPES, Output, OutputType, +1 | `modules/workflow/browser/src/ui/sections/optimization_studio/drawers/signature-prompt-editor-bridge.tsx:3`<br>`modules/workflow/browser/src/ui/sections/optimization_studio/drawers/signature-prompt-editor-bridge.tsx:4`<br>`modules/workflow/browser/src/ui/sections/optimization_studio/drawers/studio-node-drawer.tsx:3`<br>`modules/workflow/browser/src/ui/sections/optimization_studio/properties/agent-properties-panel.tsx:21`<br>`modules/workflow/browser/src/ui/sections/optimization_studio/properties/llm-configs/optimization-studio-llm-config-field.tsx:5`<br>`modules/workflow/browser/src/ui/sections/optimization_studio/properties/llm-configs/optimization-studio-llm-config-field.tsx:6` |

### The other 23 edges — already point the right way, leave them

| edge | stmts | kind | symbols | files (`file:line`) |
|---|---|---|---|---|
| `experiment-browser` → `workflow-browser` | 22 | value | useFeatureFlag, fetchSSE, FormatMoney, HoverableBigText, ExpandedTextDialog, useDejaViewLink, +8 | `modules/experiment/browser/src/behavior/batch-evaluation-results/use-show-comparison-leaderboard.ts:3`<br>`modules/experiment/browser/src/behavior/experiments-v3/use-execute-evaluation.ts:12`<br>`modules/experiment/browser/src/behavior/experiments-v3/use-optimize-with-langy.ts:3`<br>`modules/experiment/browser/src/ui/elements/experiments/BatchEvaluationV2/batch-evaluation-summary.tsx:9`<br>`modules/experiment/browser/src/ui/elements/experiments/BatchEvaluationV2/batch-evaluation-summary.tsx:10`<br>`modules/experiment/browser/src/ui/elements/experiments/BatchEvaluationV2/batch-evaluation-v2-evaluation-result.tsx:13`<br>`modules/experiment/browser/src/ui/elements/experiments/batch-evaluation-v2.tsx:22`<br>`modules/experiment/browser/src/ui/elements/experiments/batch-evaluation-v2.tsx:23`<br>`modules/experiment/browser/src/ui/elements/experiments/batch-evaluation-v2.tsx:24`<br>`modules/experiment/browser/src/ui/elements/experiments/copy-experiment-dialog.tsx:5`<br>`modules/experiment/browser/src/ui/elements/experiments/ds-py-experiment.tsx:35`<br>`modules/experiment/browser/src/ui/elements/experiments/ds-py-experiment.tsx:36`<br>`modules/experiment/browser/src/ui/elements/metadata-tag.tsx:5`<br>`modules/experiment/browser/src/ui/sections/experiments-v3/run-via-api-button.tsx:2`<br>`modules/experiment/browser/src/ui/sections/experiments-v3/run-via-api-button.tsx:3`<br>`modules/experiment/browser/src/ui/sections/experiments-v3/run-via-api-button.tsx:4`<br>`modules/experiment/browser/src/ui/sections/experiments-v3/run-via-api-button.tsx:5`<br>`modules/experiment/browser/src/ui/sections/experiments/experiment-detail.screen.tsx:5`<br>`modules/experiment/browser/src/ui/sections/experiments/experiment-detail.screen.tsx:6`<br>`modules/experiment/browser/src/ui/sections/experiments/new-workbench.screen.tsx:6`<br>`modules/experiment/browser/src/ui/sections/experiments/workbench.screen.tsx:22`<br>`modules/experiment/browser/src/ui/sections/experiments/workbench.screen.tsx:23` |
| `evaluator-browser` → `workflow-browser` | 18 | value | RenderCode, EmojiPickerModal, FormServerError, customEvaluatorTemplate, DEFAULT_EMBEDDINGS_MODEL, AddModelProviderKey, +7 | `modules/evaluator/browser/src/ui/elements/evaluations/guardrails-drawer.tsx:7`<br>`modules/evaluator/browser/src/ui/elements/evaluators/evaluator-api-usage-dialog.tsx:19`<br>`modules/evaluator/browser/src/ui/elements/evaluators/workflow-selector-for-evaluator-drawer.tsx:20`<br>`modules/evaluator/browser/src/ui/elements/evaluators/workflow-selector-for-evaluator-drawer.tsx:21`<br>`modules/evaluator/browser/src/ui/elements/evaluators/workflow-selector-for-evaluator-drawer.tsx:22`<br>`modules/evaluator/browser/src/ui/sections/checks/check-config-form.tsx:36`<br>`modules/evaluator/browser/src/ui/sections/checks/dynamic-zod-form.tsx:27`<br>`modules/evaluator/browser/src/ui/sections/checks/evaluation-manual-integration.tsx:9`<br>`modules/evaluator/browser/src/ui/sections/checks/evaluator-selection.tsx:26`<br>`modules/evaluator/browser/src/ui/sections/checks/evaluator-selection.tsx:27`<br>`modules/evaluator/browser/src/ui/sections/checks/try-it-out.tsx:34`<br>`modules/evaluator/browser/src/ui/sections/checks/try-it-out.tsx:35`<br>`modules/evaluator/browser/src/ui/sections/evaluators/code-evaluator-editor-drawer.tsx:23`<br>`modules/evaluator/browser/src/ui/sections/evaluators/code-evaluator-editor-drawer.tsx:24`<br>`modules/evaluator/browser/src/ui/sections/evaluators/evaluator-editor-content.tsx:6`<br>`modules/evaluator/browser/src/ui/sections/evaluators/evaluator-editor-shared.tsx:34`<br>`modules/evaluator/browser/src/ui/sections/evaluators/evaluator-editor-shared.tsx:35`<br>`modules/evaluator/browser/src/ui/sections/evaluators/evaluator-editor-shared.tsx:36` |
| `prompt-browser` → `prompt-browser-kit` | 17 | mixed | getMaxTokenLimit, LLMModelDisplay, buildModelChangeValues, DEFAULT_SUPPORTED_PARAMETERS, getDisplayParameters, getParameterConfigWithModelOverrides, +23 | `modules/prompt/browser/src/behavior/use-create-draft-prompt.ts:1`<br>`modules/prompt/browser/src/ui/elements/llmPromptConfigs/llm-config-field.tsx:4`<br>`modules/prompt/browser/src/ui/elements/llmPromptConfigs/llm-config-popover.tsx:10`<br>`modules/prompt/browser/src/ui/elements/outputs/outputs-section.tsx:5`<br>`modules/prompt/browser/src/ui/elements/prompts/forms/fields/message-history-fields/prompt-messages-field.tsx:8`<br>`modules/prompt/browser/src/ui/elements/prompts/forms/fields/model-select-field-mini.tsx:9`<br>`modules/prompt/browser/src/ui/elements/prompts/generate-prompt-api-snippet-dialog.tsx:3`<br>`modules/prompt/browser/src/ui/sections/prompt-studio/browser/window/prompt-browser-window-content.tsx:2`<br>`modules/prompt/browser/src/ui/sections/prompt-studio/browser/window/prompt-tabbed-section.tsx:3`<br>`modules/prompt/browser/src/ui/sections/prompt-studio/dialogs/generate-api-snippet-dialog.tsx:6`<br>`modules/prompt/browser/src/ui/sections/prompt-studio/dialogs/generate-prompt-api-snippet-dialog.tsx:2`<br>`modules/prompt/browser/src/ui/sections/prompt-studio/fields/prompt-messages-field.tsx:2`<br>`modules/prompt/browser/src/ui/sections/prompt-studio/model-selection/llm-config-popover.tsx:3`<br>`modules/prompt/browser/src/ui/sections/prompt-studio/model-selection/llm-config-popover.tsx:4`<br>`modules/prompt/browser/src/ui/sections/prompt-studio/model-selection/outputs-section.tsx:5`<br>`modules/prompt/browser/src/ui/sections/prompt-studio/prompt-browser-tab.tsx:2`<br>`modules/prompt/browser/src/ui/sections/prompts/prompt-editor-drawer.tsx:19` |
| `prompt-browser` → `workflow-browser` | 14 | mixed | fetchSSE, LlmConfigInputType, LlmConfigInputTypes, LlmConfigOutputType, LlmConfigOutputTypes, AddModelProviderKey, +6 | `modules/prompt/browser/src/behavior/playground/use-prompt-execution.ts:10`<br>`modules/prompt/browser/src/behavior/prompts/llm-prompt-config-utils.ts:10`<br>`modules/prompt/browser/src/ui/elements/llmPromptConfigs/llm-config-field.tsx:6`<br>`modules/prompt/browser/src/ui/elements/outputs/form-outputs-section.tsx:2`<br>`modules/prompt/browser/src/ui/elements/outputs/outputs-section.tsx:11`<br>`modules/prompt/browser/src/ui/elements/prompts/forms/fields/model-select-field-mini.tsx:11`<br>`modules/prompt/browser/src/ui/elements/prompts/generate-prompt-api-snippet-dialog.tsx:4`<br>`modules/prompt/browser/src/ui/sections/prompt-studio/model-selection/outputs-section.tsx:11`<br>`modules/prompt/browser/src/ui/sections/prompts/deploy-prompt-dialog.tsx:25`<br>`modules/prompt/browser/src/ui/sections/prompts/deploy-prompt-dialog.tsx:26`<br>`modules/prompt/browser/src/ui/sections/prompts/prompt-editor-drawer.tsx:27`<br>`modules/prompt/browser/src/ui/sections/prompts/prompt-editor-drawer.tsx:28`<br>`modules/prompt/browser/src/ui/sections/prompts/prompt-editor-footer.tsx:4`<br>`modules/prompt/browser/src/ui/sections/prompts/prompt-editor-header.tsx:4` |
| `experiment-browser` → `prompt-browser-kit` | 12 | mixed | AvailableSource, FieldType, FieldMapping, VariableMappingInput, VersionBadge, VariablesSection, +1 | `modules/experiment/browser/src/behavior/experiments-v3/target-available-sources.ts:3`<br>`modules/experiment/browser/src/behavior/experiments-v3/use-evaluation-mappings.ts:4`<br>`modules/experiment/browser/src/behavior/experiments-v3/use-open-evaluator-editor.ts:8`<br>`modules/experiment/browser/src/behavior/experiments-v3/use-open-target-editor.ts:9`<br>`modules/experiment/browser/src/model/experiments-v3/evaluator-editor-callbacks.ts:4`<br>`modules/experiment/browser/src/model/experiments-v3/field-mapping-converters.ts:4`<br>`modules/experiment/browser/src/model/experiments-v3/prompt-editor-callbacks.ts:4`<br>`modules/experiment/browser/src/ui/sections/experiments-v3/EvaluatorPanel/comparison-config-form.tsx:7`<br>`modules/experiment/browser/src/ui/sections/experiments-v3/TargetSection/target-header.tsx:15`<br>`modules/experiment/browser/src/ui/sections/experiments-v3/TargetSection/target-variables-panel.tsx:4`<br>`modules/experiment/browser/src/ui/sections/experiments-v3/evaluations-v3-table.tsx:22`<br>`modules/experiment/browser/src/ui/sections/experiments-v3/run-evaluation-button.tsx:8` |
| `evaluator-browser` → `analytics-browser` | 8 | mixed | filterFieldsEnum, availableFilters, FilterField, getAvailablePreconditionFields, PRECONDITION_ALLOWED_RULES, useFilterParams, +2 | `modules/evaluator/browser/src/model/evaluations/types.ts:1`<br>`modules/evaluator/browser/src/model/preconditions/precondition-field-utils.ts:1`<br>`modules/evaluator/browser/src/model/preconditions/precondition-field-utils.ts:2`<br>`modules/evaluator/browser/src/model/preconditions/precondition-field-utils.ts:3`<br>`modules/evaluator/browser/src/ui/elements/evaluations/evaluator-traces-mapping.tsx:1`<br>`modules/evaluator/browser/src/ui/sections/checks/try-it-out.tsx:16`<br>`modules/evaluator/browser/src/ui/sections/checks/try-it-out.tsx:17`<br>`modules/evaluator/browser/src/ui/sections/checks/try-it-out.tsx:18` |
| `evaluator-browser` → `prompt-browser-kit` | 7 | mixed | FieldMapping, LLMModelDisplay, toInternalKey, AvailableSource, VariablesSection, Variable | `modules/evaluator/browser/src/model/evaluations/deserialize-mapping-state-to-ui.ts:7`<br>`modules/evaluator/browser/src/model/evaluations/serialize-mappings-to-mapping-state.ts:12`<br>`modules/evaluator/browser/src/ui/elements/checks/evaluator-llm-config-field.tsx:8`<br>`modules/evaluator/browser/src/ui/elements/evaluators/evaluator-mappings-section.tsx:7`<br>`modules/evaluator/browser/src/ui/sections/evaluations/online-evaluation-drawer.tsx:28`<br>`modules/evaluator/browser/src/ui/sections/evaluators/code-evaluator-editor-drawer.tsx:18`<br>`modules/evaluator/browser/src/ui/sections/evaluators/evaluator-editor-shared.tsx:29` |
| `scenario-browser` → `trace-browser` | 7 | value | useProjectSpanNames, BUBBLE_TONES, SuggestionPanel, TracePreviewHoverCard, ConversationThread, DisplayPart, +2 | `modules/scenario/browser/src/ui/elements/agent-testing/suite/use-suite-editor.ts:23`<br>`modules/scenario/browser/src/ui/elements/typing-bubble.tsx:9`<br>`modules/scenario/browser/src/ui/sections/agent-testing/run/parameter-line-field.tsx:7`<br>`modules/scenario/browser/src/ui/sections/simulations/run-turn-separator.tsx:8`<br>`modules/scenario/browser/src/ui/sections/simulations/scenario-message-renderer.tsx:2`<br>`modules/scenario/browser/src/ui/sections/suites/run-history-panel.tsx:35`<br>`modules/scenario/browser/src/ui/sections/suites/suite-detail-panel.tsx:9` |
| `workflow-browser` → `prompt-browser-kit` | 5 | mixed | Snippet, Target, FieldMapping, VariablesSection, LLMModelDisplay, Variable | `modules/workflow/browser/src/ui/sections/generate-api-snippet-dialog.tsx:6`<br>`modules/workflow/browser/src/ui/sections/optimization_studio/drawers/signature-prompt-editor-bridge.tsx:2`<br>`modules/workflow/browser/src/ui/sections/optimization_studio/drawers/studio-node-drawer.tsx:2`<br>`modules/workflow/browser/src/ui/sections/optimization_studio/optimization-studio.tsx:18`<br>`modules/workflow/browser/src/ui/sections/optimization_studio/properties/agent-properties-panel.tsx:20` |
| `agent-browser` → `scenario-browser` | 4 | value | FieldLabel, toLineRunParameters, ParameterLineField, parameterPlaceholder | `modules/agent/browser/src/ui/sections/agent-test-panel.tsx:8`<br>`modules/agent/browser/src/ui/sections/agent-test-panel.tsx:9`<br>`modules/agent/browser/src/ui/sections/agent-test-panel.tsx:10`<br>`modules/agent/browser/src/ui/sections/agent-test-panel.tsx:11` |
| `experiment-browser` → `trace-browser` | 4 | value | TraceIdPeek, RenderInputOutput | `modules/experiment/browser/src/ui/elements/experiments/BatchEvaluationV2/batch-evaluation-v2-evaluation-result.tsx:12`<br>`modules/experiment/browser/src/ui/elements/experiments/ds-py-experiment.tsx:71`<br>`modules/experiment/browser/src/ui/sections/batch-evaluation-results/batch-evaluation-results.tsx:25`<br>`modules/experiment/browser/src/ui/sections/experiments-v3/TargetSection/target-cell.tsx:8` |
| `scenario-browser` → `prompt-browser-kit` | 4 | mixed | FieldMapping, Variable, AvailableSource, VariablesSection, LLMModelDisplay | `modules/scenario/browser/src/behavior/agent-testing/evaluators/use-open-scenario-evaluator-editor.ts:8`<br>`modules/scenario/browser/src/ui/elements/suites/prompt-target-mapping-section.tsx:6`<br>`modules/scenario/browser/src/ui/elements/suites/scenario-input-mapping-section.tsx:6`<br>`modules/scenario/browser/src/ui/sections/agent-testing/results/run-settings-block.tsx:8` |
| `workflow-browser` → `trace-browser` | 4 | value | RenderInputOutput, SpanDuration, TraceIdPeek | `modules/workflow/browser/src/ui/sections/executable-panel/execution-output-panel.tsx:12`<br>`modules/workflow/browser/src/ui/sections/executable-panel/execution-output-panel.tsx:13`<br>`modules/workflow/browser/src/ui/sections/hoverable-big-text.tsx:6`<br>`modules/workflow/browser/src/ui/sections/optimization_studio/results-panel.tsx:16` |
| `evaluator-browser` → `trace-browser` | 2 | value | TracesMapping, useProjectSpanNames | `modules/evaluator/browser/src/ui/elements/evaluations/evaluator-traces-mapping.tsx:3`<br>`modules/evaluator/browser/src/ui/elements/evaluators/evaluator-mappings-section.tsx:12` |
| `evaluator-browser` → `experiment-browser` | 2 | value | createEvaluatorEditorCallbacks, ComparisonConfigForm | `modules/evaluator/browser/src/ui/sections/evaluations/online-evaluation-drawer.tsx:26`<br>`modules/evaluator/browser/src/ui/sections/evaluators/evaluator-editor-shared.tsx:21` |
| `scenario-browser` → `workflow-browser` | 2 | value | CopyButton, useDejaViewLink | `modules/scenario/browser/src/ui/sections/simulations/scenario-run-detail-drawer.tsx:8`<br>`modules/scenario/browser/src/ui/sections/simulations/scenario-run-detail-drawer.tsx:9` |
| `analytics-browser` → `prompt-browser-kit` | 1 | value | FieldTypeSelect, VariableTypeIcon | `modules/analytics/browser/src/ui/sections/query-parameters-panel.tsx:14` |
| `evaluator-browser` → `prompt-browser` | 1 | value | LLMConfigPopover | `modules/evaluator/browser/src/ui/elements/checks/evaluator-llm-config-field.tsx:9` |
| `prompt-browser` → `trace-browser` | 1 | value | ConversationThread, DisplayPart, flattenMessages | `modules/prompt/browser/src/ui/sections/prompt-studio/chat/prompt-playground-chat.tsx:4` |
| `prompt-browser` → `experiment-browser` | 1 | value | useEvaluationMappings | `modules/prompt/browser/src/ui/sections/prompts/prompt-editor-drawer.tsx:15` |
| `scenario-browser` → `evaluator-browser` | 1 | value | REQUIRED_TO_PASS_LABEL | `modules/scenario/browser/src/ui/elements/agent-testing/suite/suite-evaluators-section.tsx:11` |
| `scenario-browser` → `experiment-browser` | 1 | value | createEvaluatorEditorCallbacks | `modules/scenario/browser/src/ui/elements/agent-testing/suite/use-suite-attachment-picker.ts:11` |
| `scenario-browser` → `prompt-browser` | 1 | value | PromptEditorDrawer | `modules/scenario/browser/src/ui/sections/scenarios/scenario-form-drawer.tsx:27` |

### Edges touching `trace-browser` (the possibly-blocked slice)

| edge | stmts | kind | symbols | files (`file:line`) |
|---|---|---|---|---|
| `scenario-browser` → `trace-browser` | 7 | value | useProjectSpanNames, BUBBLE_TONES, SuggestionPanel, TracePreviewHoverCard, ConversationThread, DisplayPart, +2 | `modules/scenario/browser/src/ui/elements/agent-testing/suite/use-suite-editor.ts:23`<br>`modules/scenario/browser/src/ui/elements/typing-bubble.tsx:9`<br>`modules/scenario/browser/src/ui/sections/agent-testing/run/parameter-line-field.tsx:7`<br>`modules/scenario/browser/src/ui/sections/simulations/run-turn-separator.tsx:8`<br>`modules/scenario/browser/src/ui/sections/simulations/scenario-message-renderer.tsx:2`<br>`modules/scenario/browser/src/ui/sections/suites/run-history-panel.tsx:35`<br>`modules/scenario/browser/src/ui/sections/suites/suite-detail-panel.tsx:9` |
| `experiment-browser` → `trace-browser` | 4 | value | TraceIdPeek, RenderInputOutput | `modules/experiment/browser/src/ui/elements/experiments/BatchEvaluationV2/batch-evaluation-v2-evaluation-result.tsx:12`<br>`modules/experiment/browser/src/ui/elements/experiments/ds-py-experiment.tsx:71`<br>`modules/experiment/browser/src/ui/sections/batch-evaluation-results/batch-evaluation-results.tsx:25`<br>`modules/experiment/browser/src/ui/sections/experiments-v3/TargetSection/target-cell.tsx:8` |
| `workflow-browser` → `trace-browser` | 4 | value | RenderInputOutput, SpanDuration, TraceIdPeek | `modules/workflow/browser/src/ui/sections/executable-panel/execution-output-panel.tsx:12`<br>`modules/workflow/browser/src/ui/sections/executable-panel/execution-output-panel.tsx:13`<br>`modules/workflow/browser/src/ui/sections/hoverable-big-text.tsx:6`<br>`modules/workflow/browser/src/ui/sections/optimization_studio/results-panel.tsx:16` |
| `evaluator-browser` → `trace-browser` | 2 | value | TracesMapping, useProjectSpanNames | `modules/evaluator/browser/src/ui/elements/evaluations/evaluator-traces-mapping.tsx:3`<br>`modules/evaluator/browser/src/ui/elements/evaluators/evaluator-mappings-section.tsx:12` |
| `trace-browser` → `scenario-browser` | 2 | mixed | MediaProbeResult, MediaPart, MediaPartProps | `modules/trace/browser/src/behavior/trace-api.ts:29`<br>`modules/trace/browser/src/ui/sections/simulations/media-part.tsx:1` |
| `trace-browser` → `evaluator-browser` | 2 | value | evaluationPassed, evaluationStatusColor | `modules/trace/browser/src/ui/sections/traces/evaluation-status-item.tsx:5`<br>`modules/trace/browser/src/ui/sections/traces/span-details.tsx:5` |
| `prompt-browser` → `trace-browser` | 1 | value | ConversationThread, DisplayPart, flattenMessages | `modules/prompt/browser/src/ui/sections/prompt-studio/chat/prompt-playground-chat.tsx:4` |

Trace-touching edges: 7 of 30. In the minimum cut: 2.
## Scheduling: which slices are free right now

7 of the 30 cycle edges touch `trace-browser`; **only 2 are in the minimum cut**. But the
assumption that trace is the blocked slice does not hold against the working tree. I checked
all 12 files in the cut against `git status --porcelain --untracked-files=all`:

**`trace-browser` is entirely clean — 4 of 4 cut files untouched.**
**`workflow-browser` and `prompt-browser-kit` are the contended ones — 5 of 8 cut files are
under active edit by another lane right now.**

| edge | file | state |
|---|---|---|
| `trace` → `evaluator` | `modules/trace/browser/src/ui/sections/traces/evaluation-status-item.tsx` | clean |
| `trace` → `evaluator` | `modules/trace/browser/src/ui/sections/traces/span-details.tsx` | clean |
| `trace` → `scenario` | `modules/trace/browser/src/behavior/trace-api.ts` | clean |
| `trace` → `scenario` | `modules/trace/browser/src/ui/sections/simulations/media-part.tsx` | clean |
| `workflow` → `agent` | `modules/workflow/browser/src/behavior/agents/http/index.ts` | clean |
| `workflow` → `evaluator` | `…/optimization_studio/properties/evaluator-properties-panel.tsx` | clean |
| `workflow` → `prompt` | `…/optimization_studio/properties/llm-configs/optimization-studio-llm-config-field.tsx` | clean |
| `workflow` → `prompt` | `…/optimization_studio/drawers/signature-prompt-editor-bridge.tsx` | **DIRTY** |
| `workflow` → `prompt` | `…/optimization_studio/drawers/studio-node-drawer.tsx` | **DIRTY** |
| `workflow` → `prompt` | `…/optimization_studio/properties/agent-properties-panel.tsx` | **DIRTY** |
| `workflow` → `experiment` | `…/optimization_studio/results-panel.tsx` | **DIRTY** |
| `prompt-kit` → `workflow` | `modules/prompt/browser-kit/src/ui/sections/api-snippet/get-prompt-snippets.ts` | **DIRTY** |

So the schedulable order is the reverse of the one you would guess:

1. **Now, uncontended (3 edges, 8 statements):** `trace` → `evaluator`, `trace` → `scenario`,
   `workflow` → `evaluator`. All four trace files and `evaluator-properties-panel.tsx` are clean.
2. **Now, but needs the ruling first (1 edge, 1 statement):** `workflow` → `agent`. The file is
   clean; only the design question blocks it.
3. **After the workflow/prompt-kit lane lands (3 edges, 9 statements):** `workflow` → `prompt`,
   `workflow` → `experiment`, `prompt-kit` → `workflow`. That lane is mid-flight — it has
   already deleted `modules/workflow/browser/src/studio-dataset-columns.ts` and
   `…/src/model/studio-dataset.utils.ts` and is adding new files under
   `modules/prompt/browser-kit/src/ui/sections/api-snippet/`, which is the very directory
   holding the `exampleParameterValue` import. Re-derive this map after it lands; the edge may
   move or disappear on its own.

Both of these are snapshots of one moment. Re-run the check before scheduling rather than
trusting the table.

## What the payoff is contingent on

**A partial fix buys nothing structural.** `dev/tsconfig.web-declarations.json` can only be
deleted when the cycle is *fully* broken — project references must be acyclic, and one
remaining back-edge keeps all 15 packages welded into the one project. Cutting 6 of the 7 edges
leaves the build exactly as it is today: same 8,542-file program, same 7.75s, same 3.56 GiB,
same all-fifteen-freeze on a single error.

So the work is all-or-nothing in its payoff, even though it is incremental in its execution.
Sequence the 5 trace-free edges first if that suits the lanes, but **budget the ruling on edge 7
(`workflow` → `agent`) early** — it is one import statement and it alone can hold the whole
payoff hostage.

On delivery, expect:
- `dev/tsconfig.web-declarations.json` deleted; 15 `tsconfig.build.json` stubs replaced by real
  per-package emit projects.
- The solution's most expensive project (7.75s, 6.95M instantiations, 3.56 GiB) removed, and
  replaced by 15 small ones whose cost is paid only by the packages that actually changed.
- Per-package declaration granularity restored: a `dataset-browser` edit stops at
  `dataset-browser` instead of re-emitting fourteen other packages.
- The single-error-freezes-fifteen failure mode gone.

I have **not** measured the post-fix state — it cannot be measured before the cycle is broken.
The 7.75s is a measured removal; the per-package replacement cost is an unmeasured addition, and
15 small programs will not be free. Treat the net as "large but unquantified", not as 7.75s saved.

## Context: this cycle is a symptom, not the disease

Rule 1 of the kit law says a module's browser package is closed — "nothing else imports it,
ever". Across the whole browser half:

- **60 illegal `*-browser` → `*-browser` package edges, across 24 target packages, on 222 import statements.**
- Worst offenders by importer count: `model-provider-browser` (8), `trace-browser` (6),
  `workflow-browser` (5), `langy-browser` (4), `experiment-browser` (4).

The 9-package cycle is the subset of those 60 that happens to close a ring. Fixing the 7 cut
edges deletes the shared project; it does not make the browser half compliant. That is a larger,
separate programme and should be budgeted as one.

## Method

- Import statements extracted statement-wise (multi-line `import`/`export … from` handled), from
  `git ls-files` plus untracked files, excluding tests, fixtures and `*.config.ts`. Files present
  in the index but deleted on disk by other lanes are skipped.
- Strongly-connected components by Tarjan over the package graph.
- Minimum feedback arc set by exhaustive local search over 30,000 randomised orderings with
  insertion-move improvement, minimising edge count and tie-breaking on import statements. 7 is
  the best found and was reached from many independent starts; it is not proven optimal, but a
  smaller cut is unlikely.
- Costs via `tsc -p <project> --incremental false --extendedDiagnostics`, wall time and RSS via
  `/usr/bin/time -l`, serialised through `haven slot run`.
- **Caveat:** the machine was shared and loaded throughout (load average 20–90 on 10 cores).
  Instantiation and type counts are deterministic and are what the conclusions rest on; wall
  times vary up to 2x between repeats and are reported only where the comparison is like-for-like.
- **Caveat:** an earlier scan of this cycle found 10 packages and 34 edges. The current tree has
  9 and 30 — `dataset-browser` left the SCC in the intervening two hours, through another lane's
  work rather than mine. The numbers here are from the tree as of this measurement.
