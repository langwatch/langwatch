# Module-graph violations (dependency-cruiser)

Generated with dependency-cruiser 18.3.1 and `parser: "swc"` (its TypeScript path
supports `>=2 <7`; this repo is on 7.0.2), `combinedDependencies: true`, and
`conditionNames: ["import","default"]` WITHOUT `"types"`. With `types` in the set,
every workspace import resolves to `dist/*.d.ts`, and a `/dist/` exclude then drops
it silently -- which reads as a perfectly clean graph.

## How to read these counts

Validated, not taken at face value:

- The rule back-reference works: 0 of the 233 boundary hits are same-module, so
  `$1` in `to.pathNot` does resolve against the `from.path` capture.
- **116 of the 233** boundary hits import a peer through a `surfaces/` subpath --
  the export shape ARCHITECTURE.md §15 already deletes and this branch is removing.
  That half is known, in-flight debt. The other 117 are not.
- **65 of the 121** contract-to-contract edges are value imports (Zod schemas
  crossing a contract boundary); the other 56 are type-only, which cost the
  typecheck cascade but nothing at runtime. The type-only tally is the least
  certain number here -- swc tags many edges `undetermined`.
- **Of the 637 cycles: 134 are in generated Prisma code** (not ours), 330 sit
  inside a single package, and **173 cross a package boundary**. Only the last
  group is structurally serious.

Counts are FILE-level edges, not package pairs. `tsPreCompilationDeps` is on, so
type-only imports count -- correct for typecheck blast radius, overstated if you
read them as runtime coupling.

Scope: 9670 modules, 33679 dependencies, 11019 cross-package edges.

## A module reached past another package boundary (233)

CLAUDE.md rule 1: a peer module is reachable only through its contract and its `*Api` token.
For browser-to-browser edges the kit law applies: a browser package is closed, and sharing
means moving the shared thing into a `*-browser-kit`.

### modules/experiment/browser -> modules/workflow/browser (24)

- `modules/experiment/browser/src/behavior/batch-evaluation-results/use-show-comparison-leaderboard.ts`
  -> `modules/workflow/browser/src/feature-flag.ts`
- `modules/experiment/browser/src/behavior/experiments-v3/target-available-sources.ts`
  -> `modules/workflow/browser/src/studio-dataset-columns.ts`
- `modules/experiment/browser/src/behavior/experiments-v3/use-evaluation-mappings.ts`
  -> `modules/workflow/browser/src/studio-dataset-columns.ts`
- `modules/experiment/browser/src/behavior/experiments-v3/use-execute-evaluation.ts`
  -> `modules/workflow/browser/src/fetch-sse.ts`
- `modules/experiment/browser/src/behavior/experiments-v3/use-optimize-with-langy.ts`
  -> `modules/workflow/browser/src/feature-flag.ts`
- `modules/experiment/browser/src/ui/elements/experiments/batch-evaluation-v2.tsx`
  -> `modules/workflow/browser/src/behavior/use-deja-view-link.ts`
- `modules/experiment/browser/src/ui/elements/experiments/batch-evaluation-v2.tsx`
  -> `modules/workflow/browser/src/format-money.ts`
- `modules/experiment/browser/src/ui/elements/experiments/batch-evaluation-v2.tsx`
  -> `modules/workflow/browser/src/version-history.ts`
- ...and 16 more

### modules/evaluator/browser -> modules/workflow/browser (18)

- `modules/evaluator/browser/src/ui/elements/evaluations/guardrails-drawer.tsx`
  -> `modules/workflow/browser/src/render-code.ts`
- `modules/evaluator/browser/src/ui/elements/evaluators/evaluator-api-usage-dialog.tsx`
  -> `modules/workflow/browser/src/render-code.ts`
- `modules/evaluator/browser/src/ui/elements/evaluators/workflow-selector-for-evaluator-drawer.tsx`
  -> `modules/workflow/browser/src/emoji-picker-modal.ts`
- `modules/evaluator/browser/src/ui/elements/evaluators/workflow-selector-for-evaluator-drawer.tsx`
  -> `modules/workflow/browser/src/handled-error-views.ts`
- `modules/evaluator/browser/src/ui/elements/evaluators/workflow-selector-for-evaluator-drawer.tsx`
  -> `modules/workflow/browser/src/workflow-templates.ts`
- `modules/evaluator/browser/src/ui/sections/checks/check-config-form.tsx`
  -> `modules/workflow/browser/src/platform-defaults.ts`
- `modules/evaluator/browser/src/ui/sections/checks/dynamic-zod-form.tsx`
  -> `modules/workflow/browser/src/add-model-provider-key.ts`
- `modules/evaluator/browser/src/ui/sections/checks/evaluation-manual-integration.tsx`
  -> `modules/workflow/browser/src/render-code.ts`
- ...and 10 more

### modules/trace/browser -> modules/onboarding/browser (17)

- `modules/trace/browser/src/model/explorer/onboarding/self-hosted-endpoint.ts`
  -> `modules/onboarding/browser/src/model/shared/build-mcp-config.ts`
- `modules/trace/browser/src/ui/elements/explorer/onboarding/sdk-setup.tsx`
  -> `modules/onboarding/browser/src/model/observability/types.ts`
- `modules/trace/browser/src/ui/elements/explorer/onboarding/sdk-setup.tsx`
  -> `modules/onboarding/browser/src/ui/blocks/observability/docs-links.tsx`
- `modules/trace/browser/src/ui/elements/explorer/onboarding/sdk-setup.tsx`
  -> `modules/onboarding/browser/src/ui/sections/observability/codegen/registry.tsx`
- `modules/trace/browser/src/ui/elements/explorer/onboarding/sdk-setup.tsx`
  -> `modules/onboarding/browser/src/ui/sections/observability/framework-grid.tsx`
- `modules/trace/browser/src/ui/elements/explorer/onboarding/sdk-setup.tsx`
  -> `modules/onboarding/browser/src/ui/sections/observability/framework-integration-code.tsx`
- `modules/trace/browser/src/ui/elements/explorer/onboarding/sdk-setup.tsx`
  -> `modules/onboarding/browser/src/ui/sections/observability/install-preview.tsx`
- `modules/trace/browser/src/ui/elements/explorer/onboarding/sdk-setup.tsx`
  -> `modules/onboarding/browser/src/ui/sections/observability/platform-grid.tsx`
- ...and 9 more

### modules/prompt/browser -> modules/workflow/browser (14)

- `modules/prompt/browser/src/behavior/playground/use-prompt-execution.ts`
  -> `modules/workflow/browser/src/fetch-sse.ts`
- `modules/prompt/browser/src/behavior/prompts/llm-prompt-config-utils.ts`
  -> `modules/workflow/browser/src/component-types.ts`
- `modules/prompt/browser/src/ui/elements/llmPromptConfigs/llm-config-field.tsx`
  -> `modules/workflow/browser/src/add-model-provider-key.ts`
- `modules/prompt/browser/src/ui/elements/outputs/form-outputs-section.tsx`
  -> `modules/workflow/browser/src/component-types.ts`
- `modules/prompt/browser/src/ui/elements/outputs/outputs-section.tsx`
  -> `modules/workflow/browser/src/ui/sections/optimization_studio/code/workflow-code-editor.transport.tsx`
- `modules/prompt/browser/src/ui/elements/prompts/forms/fields/model-select-field-mini.tsx`
  -> `modules/workflow/browser/src/component-types.ts`
- `modules/prompt/browser/src/ui/elements/prompts/generate-prompt-api-snippet-dialog.tsx`
  -> `modules/workflow/browser/src/generate-api-snippet-dialog.ts`
- `modules/prompt/browser/src/ui/sections/prompt-studio/model-selection/outputs-section.tsx`
  -> `modules/workflow/browser/src/workflow-code-editor.ts`
- ...and 6 more

### modules/trace/browser -> modules/presence/browser (13)

- `modules/trace/browser/src/behavior/presence/use-presence-feature-enabled.ts`
  -> `modules/presence/browser/src/index.ts`
- `modules/trace/browser/src/ui/sections/explorer/trace-drawer/drawer-header/drawer-header.tsx`
  -> `modules/presence/browser/src/index.ts`
- `modules/trace/browser/src/ui/sections/explorer/trace-drawer/mode-switch.tsx`
  -> `modules/presence/browser/src/index.ts`
- `modules/trace/browser/src/ui/sections/explorer/trace-drawer/span-tab-bar.tsx`
  -> `modules/presence/browser/src/index.ts`
- `modules/trace/browser/src/ui/sections/explorer/trace-drawer/trace-accordions/accordion-shell.tsx`
  -> `modules/presence/browser/src/index.ts`
- `modules/trace/browser/src/ui/sections/explorer/trace-drawer/viz-placeholder.tsx`
  -> `modules/presence/browser/src/index.ts`
- `modules/trace/browser/src/ui/sections/explorer/trace-table/registry/cells/trace/trace-cell.tsx`
  -> `modules/presence/browser/src/index.ts`
- `modules/trace/browser/src/ui/sections/presence/hooks/use-cursor-broadcast.ts`
  -> `modules/presence/browser/src/index.ts`
- ...and 5 more

### modules/evaluator/browser -> modules/analytics/browser (8)

- `modules/evaluator/browser/src/model/evaluations/types.ts`
  -> `modules/analytics/browser/src/model/filters/types.ts`
- `modules/evaluator/browser/src/model/preconditions/precondition-field-utils.ts`
  -> `modules/analytics/browser/src/model/filters/precondition-matchers.ts`
- `modules/evaluator/browser/src/model/preconditions/precondition-field-utils.ts`
  -> `modules/analytics/browser/src/model/filters/registry.ts`
- `modules/evaluator/browser/src/model/preconditions/precondition-field-utils.ts`
  -> `modules/analytics/browser/src/model/filters/types.ts`
- `modules/evaluator/browser/src/ui/elements/evaluations/evaluator-traces-mapping.tsx`
  -> `modules/analytics/browser/src/ui/sections/use-filter-params.ts`
- `modules/evaluator/browser/src/ui/sections/checks/try-it-out.tsx`
  -> `modules/analytics/browser/src/ui/sections/filters/filter-sidebar.tsx`
- `modules/evaluator/browser/src/ui/sections/checks/try-it-out.tsx`
  -> `modules/analytics/browser/src/ui/sections/filters/filter-toggle.tsx`
- `modules/evaluator/browser/src/ui/sections/checks/try-it-out.tsx`
  -> `modules/analytics/browser/src/ui/sections/use-filter-params.ts`

### modules/experiment/process -> modules/workflow/process (8)

- `modules/experiment/process/src/app/experiment-composition.build.ts`
  -> `modules/workflow/process/src/index.ts`
- `modules/experiment/process/src/app/experiment-workbench.members.ts`
  -> `modules/workflow/process/src/index.ts`
- `modules/experiment/process/src/rules/experiment-run-input.rules.ts`
  -> `modules/workflow/process/src/index.ts`
- `modules/experiment/process/src/services/experiment-cell-execution.service.ts`
  -> `modules/workflow/process/src/index.ts`
- `modules/experiment/process/src/services/experiment-connected-cell.service.ts`
  -> `modules/workflow/process/src/index.ts`
- `modules/experiment/process/src/services/experiment-run-orchestrator.service.ts`
  -> `modules/workflow/process/src/index.ts`
- `modules/experiment/process/src/services/experiment-workflow-cell.service.ts`
  -> `modules/workflow/process/src/index.ts`
- `modules/experiment/process/src/services/experiment-workflow-evaluation.service.ts`
  -> `modules/workflow/process/src/index.ts`

### modules/scenario/browser -> modules/trace/browser (7)

- `modules/scenario/browser/src/ui/elements/agent-testing/suite/use-suite-editor.ts`
  -> `modules/trace/browser/src/ui/sections/use-project-span-names.ts`
- `modules/scenario/browser/src/ui/elements/typing-bubble.tsx`
  -> `modules/trace/browser/src/ui/sections/explorer/trace-table/registry/addons/conversation/bubble.tsx`
- `modules/scenario/browser/src/ui/sections/agent-testing/run/parameter-line-field.tsx`
  -> `modules/trace/browser/src/ui/sections/explorer/search-bar/suggestion-dropdown.tsx`
- `modules/scenario/browser/src/ui/sections/simulations/run-turn-separator.tsx`
  -> `modules/trace/browser/src/ui/sections/explorer/trace-id-peek.tsx`
- `modules/scenario/browser/src/ui/sections/simulations/scenario-message-renderer.tsx`
  -> `modules/trace/browser/src/ui/sections/conversation/index.ts`
- `modules/scenario/browser/src/ui/sections/suites/run-history-panel.tsx`
  -> `modules/trace/browser/src/ui/sections/setup-with-agent-button.tsx`
- `modules/scenario/browser/src/ui/sections/suites/suite-detail-panel.tsx`
  -> `modules/trace/browser/src/ui/sections/setup-with-agent-button.tsx`

### modules/trace/browser -> modules/coding-agent/browser (7)

- `modules/trace/browser/src/behavior/trace-api.ts`
  -> `modules/coding-agent/browser/src/agent-traces.ts`
- `modules/trace/browser/src/ui/sections/explorer/trace-drawer/io-viewer.tsx`
  -> `modules/coding-agent/browser/src/agent-traces.ts`
- `modules/trace/browser/src/ui/sections/explorer/trace-drawer/session-view/session-tab.tsx`
  -> `modules/coding-agent/browser/src/agent-traces.ts`
- `modules/trace/browser/src/ui/sections/explorer/trace-drawer/terminal-view/terminal-tab.tsx`
  -> `modules/coding-agent/browser/src/agent-traces.ts`
- `modules/trace/browser/src/ui/sections/explorer/trace-drawer/terminal-view/use-session-scrollback.ts`
  -> `modules/coding-agent/browser/src/agent-traces.ts`
- `modules/trace/browser/src/ui/sections/explorer/trace-drawer/trace-edit-diff-dialog.tsx`
  -> `modules/coding-agent/browser/src/agent-traces.ts`
- `modules/trace/browser/src/ui/sections/explorer/trace-drawer/transcript/block-stack.tsx`
  -> `modules/coding-agent/browser/src/agent-traces.ts`

### modules/user/browser -> modules/coding-agent/browser (7)

- `modules/user/browser/src/ui/elements/tile-icon.tsx`
  -> `modules/coding-agent/browser/src/agent-identity.ts`
- `modules/user/browser/src/ui/sections/coding-agent-host-provider.tsx`
  -> `modules/coding-agent/browser/src/activity.ts`
- `modules/user/browser/src/ui/sections/coding-agent-usage-content.tsx`
  -> `modules/coding-agent/browser/src/agent-metrics.ts`
- `modules/user/browser/src/ui/sections/personal-workspace/personal-pull-requests.screen.tsx`
  -> `modules/coding-agent/browser/src/activity.ts`
- `modules/user/browser/src/ui/sections/personal-workspace/personal-sessions.screen.tsx`
  -> `modules/coding-agent/browser/src/activity.ts`
- `modules/user/browser/src/ui/sections/personal-workspace/project-pull-requests.screen.tsx`
  -> `modules/coding-agent/browser/src/activity.ts`
- `modules/user/browser/src/ui/sections/personal-workspace/project-sessions.screen.tsx`
  -> `modules/coding-agent/browser/src/activity.ts`

### modules/project/browser -> modules/langy/browser (6)

- `modules/project/browser/src/ui/sections/home/briefing/components/home-briefing-section.tsx`
  -> `modules/langy/browser/src/asaplangy.ts`
- `modules/project/browser/src/ui/sections/home/briefing/components/home-overview-card.tsx`
  -> `modules/langy/browser/src/asaplangy.ts`
- `modules/project/browser/src/ui/sections/home/briefing/components/langy-briefing.tsx`
  -> `modules/langy/browser/src/asaplangy.ts`
- `modules/project/browser/src/ui/sections/home/components/home-page-banners.tsx`
  -> `modules/langy/browser/src/asaplangy.ts`
- `modules/project/browser/src/ui/sections/home/components/welcome-header.tsx`
  -> `modules/langy/browser/src/asaplangy.ts`
- `modules/project/browser/src/ui/sections/home/home-screen.tsx`
  -> `modules/langy/browser/src/ui/elements/langy-theme.css`

### modules/trace/browser -> modules/annotation/browser (6)

- `modules/trace/browser/src/ui/sections/annotations/add-or-edit-annotation-score.tsx`
  -> `modules/annotation/browser/src/annotation-form.ts`
- `modules/trace/browser/src/ui/sections/explorer/trace-drawer/conversation-view/annotation-card.tsx`
  -> `modules/annotation/browser/src/annotation-card.ts`
- `modules/trace/browser/src/ui/sections/explorer/trace-drawer/conversation-view/annotation-editor-card.tsx`
  -> `modules/annotation/browser/src/annotation-form.ts`
- `modules/trace/browser/src/ui/sections/explorer/trace-drawer/conversation-view/annotation-popover.tsx`
  -> `modules/annotation/browser/src/annotation-form.ts`
- `modules/trace/browser/src/ui/sections/explorer/trace-drawer/conversation-view/use-annotation-form.ts`
  -> `modules/annotation/browser/src/annotation-form.ts`
- `modules/trace/browser/src/ui/sections/explorer/trace-table/registry/cells/trace/annotations-cell.tsx`
  -> `modules/annotation/browser/src/annotation-chips.ts`

### modules/workflow/browser -> modules/prompt/browser (6)

- `modules/workflow/browser/src/ui/sections/optimization_studio/drawers/signature-prompt-editor-bridge.tsx`
  -> `modules/prompt/browser/src/llm-prompt-config-utils.ts`
- `modules/workflow/browser/src/ui/sections/optimization_studio/drawers/signature-prompt-editor-bridge.tsx`
  -> `modules/prompt/browser/src/ui/sections/prompts/prompt-editor-drawer.tsx`
- `modules/workflow/browser/src/ui/sections/optimization_studio/drawers/studio-node-drawer.tsx`
  -> `modules/prompt/browser/src/outputs-section.ts`
- `modules/workflow/browser/src/ui/sections/optimization_studio/properties/agent-properties-panel.tsx`
  -> `modules/prompt/browser/src/outputs-section.ts`
- `modules/workflow/browser/src/ui/sections/optimization_studio/properties/llm-configs/optimization-studio-llm-config-field.tsx`
  -> `modules/prompt/browser/src/llm-config-field.ts`
- `modules/workflow/browser/src/ui/sections/optimization_studio/properties/llm-configs/optimization-studio-llm-config-field.tsx`
  -> `modules/prompt/browser/src/llm-config-popover.ts`

### modules/prompt/browser -> modules/model-provider/browser (5)

- `modules/prompt/browser/src/behavior/prompts/use-prompt-config-form.ts`
  -> `modules/model-provider/browser/src/model-limits.ts`
- `modules/prompt/browser/src/ui/elements/llmPromptConfigs/llm-config-popover.tsx`
  -> `modules/model-provider/browser/src/behavior/use-model-providers-settings.ts`
- `modules/prompt/browser/src/ui/elements/llmPromptConfigs/llm-config-popover.tsx`
  -> `modules/model-provider/browser/src/ui/elements/model-selector.tsx`
- `modules/prompt/browser/src/ui/elements/prompts/forms/fields/model-select-field-mini.tsx`
  -> `modules/model-provider/browser/src/ui/elements/model-selector.tsx`
- `modules/prompt/browser/src/ui/sections/prompts/prompt-editor-drawer.tsx`
  -> `modules/model-provider/browser/src/behavior/use-model-providers-settings.ts`

### modules/scenario/browser -> modules/model-provider/browser (5)

- `modules/scenario/browser/src/ui/sections/agent-testing/run/use-run-dialog-batch.ts`
  -> `modules/model-provider/browser/src/behavior/use-model-providers-settings.ts`
- `modules/scenario/browser/src/ui/sections/scenarios/scenario-ai-generation.tsx`
  -> `modules/model-provider/browser/src/behavior/use-model-providers-settings.ts`
- `modules/scenario/browser/src/ui/sections/scenarios/scenario-create-modal.tsx`
  -> `modules/model-provider/browser/src/behavior/use-model-providers-settings.ts`
- `modules/scenario/browser/src/ui/sections/scenarios/simulation-model-select.tsx`
  -> `modules/model-provider/browser/src/ui/elements/model-selector.tsx`
- `modules/scenario/browser/src/ui/sections/use-run-scenario.ts`
  -> `modules/model-provider/browser/src/behavior/use-model-providers-settings.ts`

### modules/agent/browser -> modules/scenario/browser (4)

- `modules/agent/browser/src/ui/sections/agent-test-panel.tsx`
  -> `modules/scenario/browser/src/model/agent-testing/run/parameter-line.ts`
- `modules/agent/browser/src/ui/sections/agent-test-panel.tsx`
  -> `modules/scenario/browser/src/ui/elements/agent-testing/shared/dialog-fields.tsx`
- `modules/agent/browser/src/ui/sections/agent-test-panel.tsx`
  -> `modules/scenario/browser/src/ui/sections/agent-testing/run/parameter-line-field.tsx`
- `modules/agent/browser/src/ui/sections/agent-test-panel.tsx`
  -> `modules/scenario/browser/src/ui/sections/agent-testing/run/parameter-suggestions.ts`

### modules/experiment/browser -> modules/trace/browser (4)

- `modules/experiment/browser/src/ui/elements/experiments/BatchEvaluationV2/batch-evaluation-v2-evaluation-result.tsx`
  -> `modules/trace/browser/src/ui/sections/explorer/trace-id-peek.tsx`
- `modules/experiment/browser/src/ui/elements/experiments/ds-py-experiment.tsx`
  -> `modules/trace/browser/src/ui/sections/traces/render-input-output.tsx`
- `modules/experiment/browser/src/ui/sections/batch-evaluation-results/batch-evaluation-results.tsx`
  -> `modules/trace/browser/src/ui/sections/explorer/trace-id-peek.tsx`
- `modules/experiment/browser/src/ui/sections/experiments-v3/TargetSection/target-cell.tsx`
  -> `modules/trace/browser/src/ui/sections/explorer/trace-id-peek.tsx`

### modules/trace/browser -> modules/share/browser (4)

- `modules/trace/browser/src/ui/sections/explorer/hooks/use-share-trace.ts`
  -> `modules/share/browser/src/share-link-views.ts`
- `modules/trace/browser/src/ui/sections/explorer/hooks/use-share-trace.ts`
  -> `modules/share/browser/src/share-links.ts`
- `modules/trace/browser/src/ui/sections/explorer/trace-drawer/drawer-header/share-trace-dialog.tsx`
  -> `modules/share/browser/src/share-link-views.ts`
- `modules/trace/browser/src/ui/sections/explorer/trace-drawer/drawer-header/share-trace-dialog.tsx`
  -> `modules/share/browser/src/share-links.ts`

### modules/workflow/browser -> modules/trace/browser (4)

- `modules/workflow/browser/src/ui/sections/executable-panel/execution-output-panel.tsx`
  -> `modules/trace/browser/src/ui/sections/traces/render-input-output.tsx`
- `modules/workflow/browser/src/ui/sections/executable-panel/execution-output-panel.tsx`
  -> `modules/trace/browser/src/ui/sections/traces/span-details.tsx`
- `modules/workflow/browser/src/ui/sections/hoverable-big-text.tsx`
  -> `modules/trace/browser/src/ui/sections/traces/render-input-output.tsx`
- `modules/workflow/browser/src/ui/sections/optimization_studio/results-panel.tsx`
  -> `modules/trace/browser/src/ui/sections/explorer/trace-id-peek.tsx`

### modules/workflow/browser -> modules/dataset/browser (4)

- `modules/workflow/browser/src/ui/sections/optimization_studio/dataset-modal.tsx`
  -> `modules/dataset/browser/src/dataset-editor-table.ts`
- `modules/workflow/browser/src/ui/sections/optimization_studio/dataset-modal.tsx`
  -> `modules/dataset/browser/src/dataset-picker-list.ts`
- `modules/workflow/browser/src/ui/sections/optimization_studio/dataset-modal.tsx`
  -> `modules/dataset/browser/src/upload-csv-drawer.ts`
- `modules/workflow/browser/src/ui/sections/optimization_studio/optimization-studio.tsx`
  -> `modules/dataset/browser/src/ui/blocks/datasets/editor/dataset-preview-table.tsx`

### modules/workflow/browser -> modules/evaluator/browser (4)

- `modules/workflow/browser/src/ui/sections/optimization_studio/properties/evaluator-properties-panel.tsx`
  -> `modules/evaluator/browser/src/available-evaluators.ts`
- `modules/workflow/browser/src/ui/sections/optimization_studio/properties/evaluator-properties-panel.tsx`
  -> `modules/evaluator/browser/src/dynamic-zod-form.ts`
- `modules/workflow/browser/src/ui/sections/optimization_studio/properties/evaluator-properties-panel.tsx`
  -> `modules/evaluator/browser/src/evaluator-editor-content.ts`
- `modules/workflow/browser/src/ui/sections/optimization_studio/properties/evaluator-properties-panel.tsx`
  -> `modules/evaluator/browser/src/ui/sections/evaluators/evaluator-editor-shared.tsx`

### modules/langy/browser -> modules/model-provider/browser (3)

- `modules/langy/browser/src/features/langy/ui/elements/langy-model-pill.tsx`
  -> `modules/model-provider/browser/src/ui/elements/model-selector.tsx`
- `modules/langy/browser/src/features/langy/ui/sections/langy-panel.tsx`
  -> `modules/model-provider/browser/src/ui/elements/model-selector.tsx`
- `modules/langy/browser/src/ui/sections/model-provider-setup.tsx`
  -> `modules/model-provider/browser/src/edit-model-provider-form.ts`

### modules/project/browser -> modules/analytics/browser (3)

- `modules/project/browser/src/ui/sections/home/briefing/hooks/use-langy-briefing.ts`
  -> `modules/analytics/browser/src/model/analytics-registry.ts`
- `modules/project/browser/src/ui/sections/home/components/traces-overview.tsx`
  -> `modules/analytics/browser/src/model/analytics-registry.ts`
- `modules/project/browser/src/ui/sections/home/components/traces-overview.tsx`
  -> `modules/analytics/browser/src/ui/sections/custom-graph.tsx`

### modules/project/browser -> modules/navigation/browser (3)

- `modules/project/browser/src/ui/sections/home/components/hero-ask-field.tsx`
  -> `modules/navigation/browser/src/command-bar.ts`
- `modules/project/browser/src/ui/sections/home/components/home-page-banners.tsx`
  -> `modules/navigation/browser/src/command-bar.ts`
- `modules/project/browser/src/ui/sections/home/components/recent-items-section.tsx`
  -> `modules/navigation/browser/src/command-bar.ts`

### modules/automation/process -> modules/notification/process (2)

- `modules/automation/process/src/services/automation-notification-delivery.service.ts`
  -> `modules/notification/process/src/index.ts`
- `modules/automation/process/src/services/automation-runaway.service.ts`
  -> `modules/notification/process/src/index.ts`

### modules/evaluator/browser -> modules/model-provider/browser (2)

- `modules/evaluator/browser/src/ui/elements/checks/evaluator-llm-config-field.tsx`
  -> `modules/model-provider/browser/src/ui/elements/model-selector.tsx`
- `modules/evaluator/browser/src/ui/sections/checks/dynamic-zod-form.tsx`
  -> `modules/model-provider/browser/src/ui/elements/model-selector.tsx`

### modules/evaluator/browser -> modules/trace/browser (2)

- `modules/evaluator/browser/src/ui/elements/evaluations/evaluator-traces-mapping.tsx`
  -> `modules/trace/browser/src/ui/sections/traces/traces-mapping.tsx`
- `modules/evaluator/browser/src/ui/elements/evaluators/evaluator-mappings-section.tsx`
  -> `modules/trace/browser/src/ui/sections/use-project-span-names.ts`

### modules/evaluator/browser -> modules/experiment/browser (2)

- `modules/evaluator/browser/src/ui/sections/evaluations/online-evaluation-drawer.tsx`
  -> `modules/experiment/browser/src/evaluator-editor-callbacks.ts`
- `modules/evaluator/browser/src/ui/sections/evaluators/evaluator-editor-shared.tsx`
  -> `modules/experiment/browser/src/comparison-config-form.ts`

### modules/experiment/browser -> modules/dataset/browser (2)

- `modules/experiment/browser/src/behavior/experiments-v3/use-dataset-sync.ts`
  -> `modules/dataset/browser/src/dataset-record-sync.ts`
- `modules/experiment/browser/src/ui/sections/experiments-v3/evaluations-v3-table.tsx`
  -> `modules/dataset/browser/src/dataset-drawer.ts`

### modules/project/browser -> modules/onboarding/browser (2)

- `modules/project/browser/src/ui/blocks/tech-stack.tsx`
  -> `modules/onboarding/browser/src/ui/blocks/tech-stack.tsx`
- `modules/project/browser/src/ui/sections/project-settings/project-settings-screen.tsx`
  -> `modules/onboarding/browser/src/ui/blocks/tech-stack.tsx`

### modules/scenario/browser -> modules/evaluator/browser (2)

- `modules/scenario/browser/src/ui/elements/agent-testing/shared/__tests__/scenarioEvaluatorEditorHarness.tsx`
  -> `modules/evaluator/browser/src/ui/sections/evaluators/evaluator-editor-shared.tsx`
- `modules/scenario/browser/src/ui/elements/agent-testing/suite/suite-evaluators-section.tsx`
  -> `modules/evaluator/browser/src/ui/sections/evaluators/evaluator-editor-shared.tsx`

### modules/scenario/browser -> modules/langy/browser (2)

- `modules/scenario/browser/src/ui/sections/shared/ai-create-modal.tsx`
  -> `modules/langy/browser/src/asaplangy.ts`
- `modules/scenario/browser/src/ui/sections/shared/ai-create-modal.tsx`
  -> `modules/langy/browser/src/ui/elements/langy-theme.css`

### modules/scenario/browser -> modules/workflow/browser (2)

- `modules/scenario/browser/src/ui/sections/simulations/scenario-run-detail-drawer.tsx`
  -> `modules/workflow/browser/src/behavior/use-deja-view-link.ts`
- `modules/scenario/browser/src/ui/sections/simulations/scenario-run-detail-drawer.tsx`
  -> `modules/workflow/browser/src/ui/sections/copy-button.tsx`

### modules/trace/browser -> modules/scenario/browser (2)

- `modules/trace/browser/src/behavior/trace-api.ts`
  -> `modules/scenario/browser/src/ui/sections/media-part.tsx`
- `modules/trace/browser/src/ui/sections/simulations/media-part.tsx`
  -> `modules/scenario/browser/src/ui/sections/media-part.tsx`

### modules/trace/browser -> modules/evaluator/browser (2)

- `modules/trace/browser/src/ui/sections/traces/evaluation-status-item.tsx`
  -> `modules/evaluator/browser/src/model/evaluation-status.ts`
- `modules/trace/browser/src/ui/sections/traces/span-details.tsx`
  -> `modules/evaluator/browser/src/model/evaluation-status.ts`

### modules/workflow/browser -> modules/model-provider/browser (2)

- `modules/workflow/browser/src/ui/sections/optimization_studio/properties/llm-configs/optimization-studio-llm-config-field.tsx`
  -> `modules/model-provider/browser/src/ui/elements/model-selector.tsx`
- `modules/workflow/browser/src/ui/sections/optimization_studio/version-to-be-used.tsx`
  -> `modules/model-provider/browser/src/ui/elements/model-selector.tsx`

### modules/workflow/browser -> modules/experiment/browser (2)

- `modules/workflow/browser/src/ui/sections/optimization_studio/results-panel.tsx`
  -> `modules/experiment/browser/src/batch-evaluation-state.ts`
- `modules/workflow/browser/src/ui/sections/optimization_studio/results-panel.tsx`
  -> `modules/experiment/browser/src/batch-results.ts`

### modules/annotation/browser -> modules/organization/browser (1)

- `modules/annotation/browser/src/behavior/use-personal-feature-gate.ts`
  -> `modules/organization/browser/src/behavior/personal-workspace-features-api.ts`

### modules/automation/process -> modules/entitlement/process (1)

- `modules/automation/process/src/services/automation-next-step.service.ts`
  -> `modules/entitlement/process/src/index.ts`

### modules/dataset/browser -> modules/workflow/browser (1)

- `modules/dataset/browser/src/ui/sections/datasets/add-or-edit-dataset-drawer.tsx`
  -> `modules/workflow/browser/src/studio-dataset-columns.ts`

### modules/evaluation/process -> modules/workflow/process (1)

- `modules/evaluation/process/src/services/workflow-evaluation.service.ts`
  -> `modules/workflow/process/src/index.ts`

### modules/evaluator/browser -> modules/prompt/browser (1)

- `modules/evaluator/browser/src/ui/elements/checks/evaluator-llm-config-field.tsx`
  -> `modules/prompt/browser/src/llm-config-popover.ts`

### modules/experiment/browser -> modules/langy/browser (1)

- `modules/experiment/browser/src/ui/sections/experiments/workbench.screen.tsx`
  -> `modules/langy/browser/src/langy-page-registration.ts`

### modules/langy/browser -> modules/github/browser (1)

- `modules/langy/browser/src/features/langy/ui/sections/github/langy-git-hub-connect-card.tsx`
  -> `modules/github/browser/src/behavior/github-connect-popup.ts`

### modules/monitor/process -> modules/analytics/process (1)

- `modules/monitor/process/src/__tests__/support/monitor-performance.fixtures.ts`
  -> `modules/analytics/process/src/index.ts`

### modules/onboarding/browser -> modules/model-provider/browser (1)

- `modules/onboarding/browser/src/ui/sections/model-provider/model-provider-setup.tsx`
  -> `modules/model-provider/browser/src/edit-model-provider-form.ts`

### modules/ops/browser -> modules/feature-flag/browser (1)

- `modules/ops/browser/src/features/feature-flags/ui/sections/feature-flags-content.tsx`
  -> `modules/feature-flag/browser/src/experiment-catalogue.ts`

### modules/organization/process -> modules/entitlement/process (1)

- `modules/organization/process/src/app/organization-composition.build.ts`
  -> `modules/entitlement/process/src/index.ts`

### modules/project/browser -> modules/trace/browser (1)

- `modules/project/browser/src/ui/sections/home/components/onboard-agent-pill.tsx`
  -> `modules/trace/browser/src/ui/sections/setup-with-agent-button.tsx`

### modules/project/browser -> modules/organization/browser (1)

- `modules/project/browser/src/ui/sections/project-settings/project-settings-screen.tsx`
  -> `modules/organization/browser/src/department-picker.ts`

### modules/prompt/browser-kit -> modules/model-provider/browser (1)

- `modules/prompt/browser-kit/src/ui/elements/llm-model-display.tsx`
  -> `modules/model-provider/browser/src/ui/elements/model-selector.tsx`

### modules/prompt/browser-kit -> modules/workflow/browser (1)

- `modules/prompt/browser-kit/src/ui/sections/api-snippet/get-prompt-snippets.ts`
  -> `modules/workflow/browser/src/evaluate-api-snippet.ts`

### modules/prompt/browser -> modules/trace/browser (1)

- `modules/prompt/browser/src/ui/sections/prompt-studio/chat/prompt-playground-chat.tsx`
  -> `modules/trace/browser/src/ui/sections/conversation/index.ts`

### modules/prompt/browser -> modules/onboarding/browser (1)

- `modules/prompt/browser/src/ui/sections/prompt-studio/dialogs/generate-api-snippet-dialog.tsx`
  -> `modules/onboarding/browser/src/ui/sections/observability/code-preview.tsx`

### modules/prompt/browser -> modules/experiment/browser (1)

- `modules/prompt/browser/src/ui/sections/prompts/prompt-editor-drawer.tsx`
  -> `modules/experiment/browser/src/evaluation-mappings.ts`

### modules/scenario/browser -> modules/experiment/browser (1)

- `modules/scenario/browser/src/ui/elements/agent-testing/suite/use-suite-attachment-picker.ts`
  -> `modules/experiment/browser/src/evaluator-editor-callbacks.ts`

### modules/scenario/browser -> modules/prompt/browser (1)

- `modules/scenario/browser/src/ui/sections/scenarios/scenario-form-drawer.tsx`
  -> `modules/prompt/browser/src/ui/sections/prompts/prompt-editor-drawer.tsx`

### modules/trace/browser -> modules/dataset/browser (1)

- `modules/trace/browser/src/ui/sections/datasets/dataset-mapping-preview.tsx`
  -> `modules/dataset/browser/src/ui/blocks/datasets/editor/dataset-preview-table.tsx`

### modules/trace/browser -> modules/suite/browser (1)

- `modules/trace/browser/src/ui/sections/explorer/trace-drawer/scenario-chip.tsx`
  -> `modules/suite/browser/src/run-formatters.ts`

### modules/workflow/browser -> modules/agent/browser (1)

- `modules/workflow/browser/src/behavior/agents/http/index.ts`
  -> `modules/agent/browser/src/agent-http-editor.ts`

## A contract imported another contract (112)

Ruling: no contract may import another contract. A service may import a contract,
because a service might need to talk to that module.

### modules/experiment/contract -> modules/workflow/contract (12)

- `modules/experiment/contract/src/experiment-workbench.ts`
  -> `modules/workflow/contract/src/index.ts`
- `modules/experiment/contract/src/experiment.api.ts`
  -> `modules/workflow/contract/src/index.ts`
- `modules/experiment/contract/src/experiment.responses.ts`
  -> `modules/workflow/contract/src/index.ts`
- `modules/experiment/contract/src/experiment.trpc.ts`
  -> `modules/workflow/contract/src/index.ts`
- `modules/experiment/contract/src/workbench/actions/schemas.ts`
  -> `modules/workflow/contract/src/index.ts`
- `modules/experiment/contract/src/workbench/actions/transforms/add-evaluator.ts`
  -> `modules/workflow/contract/src/index.ts`
- `modules/experiment/contract/src/workbench/actions/transforms/add-target.ts`
  -> `modules/workflow/contract/src/index.ts`
- `modules/experiment/contract/src/workbench/actions/transforms/set-target-prompt.ts`
  -> `modules/workflow/contract/src/index.ts`
- ...and 4 more

### modules/suite/contract -> modules/scenario/contract (9)

- `modules/suite/contract/src/plan-config.ts`
  -> `modules/scenario/contract/src/index.ts`
- `modules/suite/contract/src/platform-path.ts`
  -> `modules/scenario/contract/src/index.ts`
- `modules/suite/contract/src/suite-evaluators.ts`
  -> `modules/scenario/contract/src/index.ts`
- `modules/suite/contract/src/suite-rest.schemas.ts`
  -> `modules/scenario/contract/src/index.ts`
- `modules/suite/contract/src/suite-trpc.schemas.ts`
  -> `modules/scenario/contract/src/index.ts`
- `modules/suite/contract/src/suite.api.ts`
  -> `modules/scenario/contract/src/index.ts`
- `modules/suite/contract/src/suite.trpc.ts`
  -> `modules/scenario/contract/src/index.ts`
- `modules/suite/contract/src/suite.ts`
  -> `modules/scenario/contract/src/index.ts`
- ...and 1 more

### modules/coding-agent/contract -> modules/trace/contract (7)

- `modules/coding-agent/contract/src/coding-agent-transcript-codex.ts`
  -> `modules/trace/contract/src/index.ts`
- `modules/coding-agent/contract/src/coding-agent-transcript-content.ts`
  -> `modules/trace/contract/src/index.ts`
- `modules/coding-agent/contract/src/coding-agent-transcript-span.ts`
  -> `modules/trace/contract/src/index.ts`
- `modules/coding-agent/contract/src/coding-agent-transcript-state.ts`
  -> `modules/trace/contract/src/index.ts`
- `modules/coding-agent/contract/src/coding-agent-transcript-value.ts`
  -> `modules/trace/contract/src/index.ts`
- `modules/coding-agent/contract/src/coding-agent-transcript.ts`
  -> `modules/trace/contract/src/index.ts`
- `modules/coding-agent/contract/src/coding-agent.api.ts`
  -> `modules/trace/contract/src/index.ts`

### modules/evaluation/contract -> modules/evaluator/contract (6)

- `modules/evaluation/contract/src/evaluation-legacy.schemas.ts`
  -> `modules/evaluator/contract/src/index.ts`
- `modules/evaluation/contract/src/evaluation-rest.schemas.ts`
  -> `modules/evaluator/contract/src/index.ts`
- `modules/evaluation/contract/src/evaluation-trpc.schemas.ts`
  -> `modules/evaluator/contract/src/index.ts`
- `modules/evaluation/contract/src/evaluation.api.ts`
  -> `modules/evaluator/contract/src/index.ts`
- `modules/evaluation/contract/src/evaluation.responses.ts`
  -> `modules/evaluator/contract/src/index.ts`
- `modules/evaluation/contract/src/worker-evaluation.config.ts`
  -> `modules/evaluator/contract/src/index.ts`

### modules/experiment/contract -> modules/evaluator/contract (6)

- `modules/experiment/contract/src/experiment-workbench.ts`
  -> `modules/evaluator/contract/src/index.ts`
- `modules/experiment/contract/src/workbench/actions/projection.ts`
  -> `modules/evaluator/contract/src/index.ts`
- `modules/experiment/contract/src/workbench/actions/schemas.ts`
  -> `modules/evaluator/contract/src/index.ts`
- `modules/experiment/contract/src/workbench/compute-aggregates.ts`
  -> `modules/evaluator/contract/src/index.ts`
- `modules/experiment/contract/src/workbench/execution/types.ts`
  -> `modules/evaluator/contract/src/index.ts`
- `modules/experiment/contract/src/workbench/mapping-validation.ts`
  -> `modules/evaluator/contract/src/index.ts`

### modules/role/contract -> modules/authz/contract (5)

- `modules/role/contract/src/role-binding.schemas.ts`
  -> `modules/authz/contract/src/index.ts`
- `modules/role/contract/src/role-binding.trpc.ts`
  -> `modules/authz/contract/src/index.ts`
- `modules/role/contract/src/role-rest.schemas.ts`
  -> `modules/authz/contract/src/index.ts`
- `modules/role/contract/src/role.api.ts`
  -> `modules/authz/contract/src/index.ts`
- `modules/role/contract/src/role.schemas.ts`
  -> `modules/authz/contract/src/index.ts`

### modules/ops/contract -> modules/feature-flag/contract (3)

- `modules/ops/contract/src/ops-feature-flag.ts`
  -> `modules/feature-flag/contract/src/index.ts`
- `modules/ops/contract/src/ops-platform.trpc.ts`
  -> `modules/feature-flag/contract/src/index.ts`
- `modules/ops/contract/src/ops.api.ts`
  -> `modules/feature-flag/contract/src/index.ts`

### modules/scenario/contract -> modules/evaluator/contract (3)

- `modules/scenario/contract/src/evaluations/runScenarioEvaluations.ts`
  -> `modules/evaluator/contract/src/index.ts`
- `modules/scenario/contract/src/evaluator-attachments.ts`
  -> `modules/evaluator/contract/src/index.ts`
- `modules/scenario/contract/src/scenario-run-evaluators.ts`
  -> `modules/evaluator/contract/src/index.ts`

### modules/stored-object/contract -> modules/authz/contract (3)

- `modules/stored-object/contract/src/audiences.ts`
  -> `modules/authz/contract/src/index.ts`
- `modules/stored-object/contract/src/stored-object.commands.ts`
  -> `modules/authz/contract/src/index.ts`
- `modules/stored-object/contract/src/stored-object.queries.ts`
  -> `modules/authz/contract/src/index.ts`

### modules/trace/contract -> modules/analytics/contract (3)

- `modules/trace/contract/src/trace-export.vocabulary.ts`
  -> `modules/analytics/contract/src/index.ts`
- `modules/trace/contract/src/trace-rest.schemas.ts`
  -> `modules/analytics/contract/src/index.ts`
- `modules/trace/contract/src/traces.trpc.ts`
  -> `modules/analytics/contract/src/index.ts`

### modules/auth/contract -> modules/identity/contract (2)

- `modules/auth/contract/src/auth.api.ts`
  -> `modules/identity/contract/src/index.ts`
- `modules/auth/contract/src/front-door.trpc.ts`
  -> `modules/identity/contract/src/index.ts`

### modules/automation/contract -> modules/monitor/contract (2)

- `modules/automation/contract/src/automation.api.ts`
  -> `modules/monitor/contract/src/index.ts`
- `modules/automation/contract/src/automation.responses.ts`
  -> `modules/monitor/contract/src/index.ts`

### modules/dashboard/contract -> modules/analytics/contract (2)

- `modules/dashboard/contract/src/dashboard.api.ts`
  -> `modules/analytics/contract/src/index.ts`
- `modules/dashboard/contract/src/saved-workbench-chart.trpc.ts`
  -> `modules/analytics/contract/src/index.ts`

### modules/dashboard/contract -> modules/automation/contract (2)

- `modules/dashboard/contract/src/dashboard.api.ts`
  -> `modules/automation/contract/src/index.ts`
- `modules/dashboard/contract/src/graph.trpc.ts`
  -> `modules/automation/contract/src/index.ts`

### modules/experiment/contract -> modules/dataset/contract (2)

- `modules/experiment/contract/src/experiment-workbench.ts`
  -> `modules/dataset/contract/src/index.ts`
- `modules/experiment/contract/src/experiment.api.ts`
  -> `modules/dataset/contract/src/index.ts`

### modules/monitor/contract -> modules/evaluation/contract (2)

- `modules/monitor/contract/src/monitor.api.ts`
  -> `modules/evaluation/contract/src/index.ts`
- `modules/monitor/contract/src/monitor.trpc.ts`
  -> `modules/evaluation/contract/src/index.ts`

### modules/ops/contract -> modules/project/contract (2)

- `modules/ops/contract/src/ops.api.ts`
  -> `modules/project/contract/src/index.ts`
- `modules/ops/contract/src/ops.responses.ts`
  -> `modules/project/contract/src/index.ts`

### modules/scenario/contract -> modules/trace/contract (2)

- `modules/scenario/contract/src/evaluations/resolveScenarioMappings.ts`
  -> `modules/trace/contract/src/index.ts`
- `modules/scenario/contract/src/evaluations/runScenarioEvaluations.ts`
  -> `modules/trace/contract/src/index.ts`

### modules/scenario/contract -> modules/automation/contract (2)

- `modules/scenario/contract/src/http-template-engine.ts`
  -> `modules/automation/contract/src/index.ts`
- `modules/scenario/contract/src/scenario-content-template.ts`
  -> `modules/automation/contract/src/index.ts`

### modules/scenario/contract -> modules/model-provider/contract (2)

- `modules/scenario/contract/src/run-models.ts`
  -> `modules/model-provider/contract/src/index.ts`
- `modules/scenario/contract/src/scenario-rest.schemas.ts`
  -> `modules/model-provider/contract/src/index.ts`

### modules/scenario/contract -> modules/agent/contract (2)

- `modules/scenario/contract/src/scenario.api.ts`
  -> `modules/agent/contract/src/index.ts`
- `modules/scenario/contract/src/voice/voice-agent.config.ts`
  -> `modules/agent/contract/src/index.ts`

### modules/share/contract -> modules/data-retention/contract (2)

- `modules/share/contract/src/pinned-trace.trpc.ts`
  -> `modules/data-retention/contract/src/index.ts`
- `modules/share/contract/src/share.api.ts`
  -> `modules/data-retention/contract/src/index.ts`

### modules/trace/contract -> modules/evaluation/contract (2)

- `modules/trace/contract/src/trace-list-view.ts`
  -> `modules/evaluation/contract/src/index.ts`
- `modules/trace/contract/src/trace.responses.ts`
  -> `modules/evaluation/contract/src/index.ts`

### modules/user/contract -> modules/organization/contract (2)

- `modules/user/contract/src/user.api.ts`
  -> `modules/organization/contract/src/index.ts`
- `modules/user/contract/src/user.responses.ts`
  -> `modules/organization/contract/src/index.ts`

### modules/workflow/contract -> modules/dataset/contract (2)

- `modules/workflow/contract/src/dataset-transposition.ts`
  -> `modules/dataset/contract/src/index.ts`
- `modules/workflow/contract/src/studio-workflow.ts`
  -> `modules/dataset/contract/src/index.ts`

### modules/workflow/contract -> modules/evaluator/contract (2)

- `modules/workflow/contract/src/studio-workflow.ts`
  -> `modules/evaluator/contract/src/index.ts`
- `modules/workflow/contract/src/workflow.api.ts`
  -> `modules/evaluator/contract/src/index.ts`

### modules/annotation/contract -> modules/user/contract (1)

- `modules/annotation/contract/src/annotation-response.schemas.ts`
  -> `modules/user/contract/src/index.ts`

### modules/annotation/contract -> modules/trace/contract (1)

- `modules/annotation/contract/src/annotation-review.schemas.ts`
  -> `modules/trace/contract/src/index.ts`

### modules/api-key/contract -> modules/authz/contract (1)

- `modules/api-key/contract/src/api-key.permissions.ts`
  -> `modules/authz/contract/src/index.ts`

### modules/api-key/contract -> modules/project/contract (1)

- `modules/api-key/contract/src/api-key.tokens.ts`
  -> `modules/project/contract/src/index.ts`

### modules/dataset/contract -> modules/annotation/contract (1)

- `modules/dataset/contract/src/trace-mapping.ts`
  -> `modules/annotation/contract/src/index.ts`

### modules/dataset/contract -> modules/trace/contract (1)

- `modules/dataset/contract/src/trace-mapping.ts`
  -> `modules/trace/contract/src/index.ts`

### modules/entitlement/contract -> modules/authz/contract (1)

- `modules/entitlement/contract/src/member-classification.ts`
  -> `modules/authz/contract/src/index.ts`

### modules/evaluation/contract -> modules/experiment/contract (1)

- `modules/evaluation/contract/src/evaluation-rest.schemas.ts`
  -> `modules/experiment/contract/src/index.ts`

### modules/evaluator/contract -> modules/analytics/contract (1)

- `modules/evaluator/contract/src/evaluation-types.ts`
  -> `modules/analytics/contract/src/index.ts`

### modules/experiment/contract -> modules/model-provider/contract (1)

- `modules/experiment/contract/src/experiment.api.ts`
  -> `modules/model-provider/contract/src/index.ts`

### modules/experiment/contract -> modules/authz/contract (1)

- `modules/experiment/contract/src/workbench/actions/manifest.ts`
  -> `modules/authz/contract/src/index.ts`

### modules/experiment/contract -> modules/scenario/contract (1)

- `modules/experiment/contract/src/workbench/connected-agent-target.ts`
  -> `modules/scenario/contract/src/index.ts`

### modules/langy/contract -> modules/authz/contract (1)

- `modules/langy/contract/src/langy-permission-policy.ts`
  -> `modules/authz/contract/src/index.ts`

### modules/monitor/contract -> modules/evaluator/contract (1)

- `modules/monitor/contract/src/monitor.ts`
  -> `modules/evaluator/contract/src/index.ts`

### modules/organization/contract -> modules/authz/contract (1)

- `modules/organization/contract/src/organization.api.ts`
  -> `modules/authz/contract/src/index.ts`

### modules/organization/contract -> modules/project/contract (1)

- `modules/organization/contract/src/organization.api.ts`
  -> `modules/project/contract/src/index.ts`

### modules/scenario/contract -> modules/workflow/contract (1)

- `modules/scenario/contract/src/evaluator-attachments.ts`
  -> `modules/workflow/contract/src/index.ts`

### modules/scenario/contract -> modules/user/contract (1)

- `modules/scenario/contract/src/scenario.api.ts`
  -> `modules/user/contract/src/index.ts`

### modules/scenario/contract -> modules/feature-flag/contract (1)

- `modules/scenario/contract/src/voice/voice-session.service.ts`
  -> `modules/feature-flag/contract/src/index.ts`

### modules/suite/contract -> modules/evaluator/contract (1)

- `modules/suite/contract/src/suite-evaluators.ts`
  -> `modules/evaluator/contract/src/index.ts`

### modules/suite/contract -> modules/model-provider/contract (1)

- `modules/suite/contract/src/suite-trpc.schemas.ts`
  -> `modules/model-provider/contract/src/index.ts`

### modules/workflow/contract -> modules/agent/contract (1)

- `modules/workflow/contract/src/studio-workflow.ts`
  -> `modules/agent/contract/src/index.ts`

### modules/workflow/contract -> modules/authz/contract (1)

- `modules/workflow/contract/src/workflow.api.ts`
  -> `modules/authz/contract/src/index.ts`

## An enterprise contract imported another contract (9)

### enterprise/modules/licensing/contract -> modules/entitlement/contract (4)

- `enterprise/modules/licensing/contract/src/license-plan.ts`
  -> `modules/entitlement/contract/src/index.ts`
- `enterprise/modules/licensing/contract/src/license.service.ts`
  -> `modules/entitlement/contract/src/index.ts`
- `enterprise/modules/licensing/contract/src/license.ts`
  -> `modules/entitlement/contract/src/index.ts`
- `enterprise/modules/licensing/contract/src/licensing.api.ts`
  -> `modules/entitlement/contract/src/index.ts`

### enterprise/modules/billing/contract -> enterprise/modules/licensing/contract (3)

- `enterprise/modules/billing/contract/src/billing-types.ts`
  -> `enterprise/modules/licensing/contract/src/index.ts`
- `enterprise/modules/billing/contract/src/billing.service.ts`
  -> `enterprise/modules/licensing/contract/src/index.ts`
- `enterprise/modules/billing/contract/src/plan-limits.ts`
  -> `enterprise/modules/licensing/contract/src/index.ts`

### enterprise/modules/billing/contract -> modules/organization/contract (1)

- `enterprise/modules/billing/contract/src/billing.errors.ts`
  -> `modules/organization/contract/src/index.ts`

### enterprise/modules/governance/contract -> modules/api-key/contract (1)

- `enterprise/modules/governance/contract/src/ingestion-source-key.commands.ts`
  -> `modules/api-key/contract/src/index.ts`

## Circular dependency (637)

### packages/prisma-client -> packages/prisma-client (134)

- `packages/prisma-client/src/generated/commonInputTypes.ts`
  -> `packages/prisma-client/src/generated/internal/prismaNamespace.ts`
- `packages/prisma-client/src/generated/internal/class.ts`
  -> `packages/prisma-client/src/generated/internal/prismaNamespace.ts`
- `packages/prisma-client/src/generated/models.ts`
  -> `packages/prisma-client/src/generated/models/Account.ts`
- `packages/prisma-client/src/generated/models.ts`
  -> `packages/prisma-client/src/generated/models/AccountCredential.ts`
- `packages/prisma-client/src/generated/models.ts`
  -> `packages/prisma-client/src/generated/models/Agent.ts`
- `packages/prisma-client/src/generated/models.ts`
  -> `packages/prisma-client/src/generated/models/AiToolEntry.ts`
- `packages/prisma-client/src/generated/models.ts`
  -> `packages/prisma-client/src/generated/models/AiToolEntryDepartment.ts`
- `packages/prisma-client/src/generated/models.ts`
  -> `packages/prisma-client/src/generated/models/AiToolEntryTeam.ts`
- ...and 126 more

### modules/experiment/contract -> modules/experiment/contract (93)

- `modules/experiment/contract/src/experiment-workbench-version.ts`
  -> `modules/experiment/contract/src/experiment-workbench-persistence.ts`
- `modules/experiment/contract/src/experiment-workbench-version.ts`
  -> `modules/experiment/contract/src/experiment-workbench.ts`
- `modules/experiment/contract/src/experiment.api.ts`
  -> `modules/experiment/contract/src/experiment-workbench-version.ts`
- `modules/experiment/contract/src/experiment.api.ts`
  -> `modules/experiment/contract/src/experiment.responses.ts`
- `modules/experiment/contract/src/experiment.responses.ts`
  -> `modules/experiment/contract/src/experiment-workbench-persistence.ts`
- `modules/experiment/contract/src/experiment.responses.ts`
  -> `modules/experiment/contract/src/experiment-workbench-version.ts`
- `modules/experiment/contract/src/experiment.trpc.ts`
  -> `modules/experiment/contract/src/experiment-workbench-persistence.ts`
- `modules/experiment/contract/src/experiment.trpc.ts`
  -> `modules/experiment/contract/src/experiment-workbench-version.ts`
- ...and 85 more

### modules/trace/process -> modules/trace/process (35)

- `modules/trace/process/src/app/trace-composition.build.ts`
  -> `modules/trace/process/src/app/trace.app.ts`
- `modules/trace/process/src/app/trace-composition.types.ts`
  -> `modules/trace/process/src/app/trace.app.ts`
- `modules/trace/process/src/app/trace-read.composition.ts`
  -> `modules/trace/process/src/app/trace-composition.build.ts`
- `modules/trace/process/src/app/trace-read.composition.ts`
  -> `modules/trace/process/src/app/trace.app.ts`
- `modules/trace/process/src/app/trace.members.ts`
  -> `modules/trace/process/src/services/eventing.trace-pipeline.service.ts`
- `modules/trace/process/src/eventing/span-storage.projection.ts`
  -> `modules/trace/process/src/app/trace.members.ts`
- `modules/trace/process/src/eventing/span-storage.projection.ts`
  -> `modules/trace/process/src/services/span-cost.service.ts`
- `modules/trace/process/src/eventing/trace-derived.projection.ts`
  -> `modules/trace/process/src/eventing/trace-summary.projection.ts`
- ...and 27 more

### modules/github/process -> modules/github/process (25)

- `modules/github/process/src/app/github.app.ts`
  -> `modules/github/process/src/app/redis-github-app-token-cache.ts`
- `modules/github/process/src/app/github.app.ts`
  -> `modules/github/process/src/repositories/redis/redis.github-pull-request-status-cache.repository.ts`
- `modules/github/process/src/app/github.app.ts`
  -> `modules/github/process/src/services/github-branch-demand.service.ts`
- `modules/github/process/src/app/github.app.ts`
  -> `modules/github/process/src/services/github-branch-maintenance.service.ts`
- `modules/github/process/src/app/github.app.ts`
  -> `modules/github/process/src/services/github-branch-mapping.service.ts`
- `modules/github/process/src/app/github.app.ts`
  -> `modules/github/process/src/services/github-installation-access.service.ts`
- `modules/github/process/src/app/github.app.ts`
  -> `modules/github/process/src/services/github-installations.service.ts`
- `modules/github/process/src/app/github.app.ts`
  -> `modules/github/process/src/services/github-pull-request-mapping.service.ts`
- ...and 17 more

### modules/workflow/contract -> modules/workflow/contract (25)

- `modules/workflow/contract/src/index.ts`
  -> `modules/workflow/contract/src/llm-signature-node-factory.ts`
- `modules/workflow/contract/src/index.ts`
  -> `modules/workflow/contract/src/merge-local-configs.ts`
- `modules/workflow/contract/src/index.ts`
  -> `modules/workflow/contract/src/studio-entry-input-defaults.ts`
- `modules/workflow/contract/src/index.ts`
  -> `modules/workflow/contract/src/studio-events.ts`
- `modules/workflow/contract/src/index.ts`
  -> `modules/workflow/contract/src/studio-optimization.ts`
- `modules/workflow/contract/src/index.ts`
  -> `modules/workflow/contract/src/studio-workflow-fields.ts`
- `modules/workflow/contract/src/index.ts`
  -> `modules/workflow/contract/src/studio-workflow-node-utils.ts`
- `modules/workflow/contract/src/index.ts`
  -> `modules/workflow/contract/src/studio-workflow-utils.ts`
- ...and 17 more

### modules/scenario/browser -> modules/scenario/browser (24)

- `modules/scenario/browser/src/ui/sections/agent-testing/cases/cases-panel-body.tsx`
  -> `modules/scenario/browser/src/ui/sections/agent-testing/cases/cases-panel.tsx`
- `modules/scenario/browser/src/ui/sections/agent-testing/cases/cases-panel-header.tsx`
  -> `modules/scenario/browser/src/ui/sections/agent-testing/cases/cases-panel.tsx`
- `modules/scenario/browser/src/ui/sections/agent-testing/cases/suite-rail-footer.tsx`
  -> `modules/scenario/browser/src/ui/sections/agent-testing/cases/suite-rail.tsx`
- `modules/scenario/browser/src/ui/sections/agent-testing/cases/suite-rail-sections.tsx`
  -> `modules/scenario/browser/src/ui/sections/agent-testing/cases/suite-rail.tsx`
- `modules/scenario/browser/src/ui/sections/agent-testing/cases/use-case-customize-blocks.ts`
  -> `modules/scenario/browser/src/ui/sections/agent-testing/cases/use-case-editor.ts`
- `modules/scenario/browser/src/ui/sections/agent-testing/drawers/agent-testing-run-drawer.tsx`
  -> `modules/scenario/browser/src/ui/sections/agent-testing/drawers/run-drawer-content.tsx`
- `modules/scenario/browser/src/ui/sections/agent-testing/drawers/agent-testing-run-drawer.tsx`
  -> `modules/scenario/browser/src/ui/sections/agent-testing/drawers/run-drawer-header-band.tsx`
- `modules/scenario/browser/src/ui/sections/agent-testing/drawers/agent-testing-run-drawer.tsx`
  -> `modules/scenario/browser/src/ui/sections/agent-testing/drawers/use-run-drawer-state.ts`
- ...and 16 more

### modules/scenario/contract -> modules/scenario/contract (20)

- `modules/scenario/contract/src/evaluations/types.ts`
  -> `modules/scenario/contract/src/scenario-run-evaluators.ts`
- `modules/scenario/contract/src/index.ts`
  -> `modules/scenario/contract/src/run-parameters.ts`
- `modules/scenario/contract/src/index.ts`
  -> `modules/scenario/contract/src/scenario-content-template.ts`
- `modules/scenario/contract/src/index.ts`
  -> `modules/scenario/contract/src/scenario-run-evaluators.ts`
- `modules/scenario/contract/src/index.ts`
  -> `modules/scenario/contract/src/scenario-run-parameter.error.ts`
- `modules/scenario/contract/src/index.ts`
  -> `modules/scenario/contract/src/scenario.api.ts`
- `modules/scenario/contract/src/index.ts`
  -> `modules/scenario/contract/src/scenario.responses.ts`
- `modules/scenario/contract/src/index.ts`
  -> `modules/scenario/contract/src/scenario.trpc.ts`
- ...and 12 more

### modules/workflow/process -> modules/workflow/process (19)

- `modules/workflow/process/src/app/workflow.app.ts`
  -> `modules/workflow/process/src/channels/http/http.workflow-nlp-runtime.channel.ts`
- `modules/workflow/process/src/app/workflow.app.ts`
  -> `modules/workflow/process/src/services/nlp-lambda-cleanup.service.ts`
- `modules/workflow/process/src/app/workflow.app.ts`
  -> `modules/workflow/process/src/services/studio-event-preparer.service.ts`
- `modules/workflow/process/src/app/workflow.app.ts`
  -> `modules/workflow/process/src/services/workflow-agent-mapping.service.ts`
- `modules/workflow/process/src/app/workflow.app.ts`
  -> `modules/workflow/process/src/services/workflow-dsl-migration.service.ts`
- `modules/workflow/process/src/app/workflow.app.ts`
  -> `modules/workflow/process/src/services/workflow-nlp-execution.service.ts`
- `modules/workflow/process/src/app/workflow.app.ts`
  -> `modules/workflow/process/src/services/workflow-project-environment.service.ts`
- `modules/workflow/process/src/app/workflow.app.ts`
  -> `modules/workflow/process/src/services/workflow-studio-dispatch.service.ts`
- ...and 11 more

### modules/experiment/process -> modules/experiment/process (14)

- `modules/experiment/process/src/app/experiment-composition.build.ts`
  -> `modules/experiment/process/src/app/experiment.app.ts`
- `modules/experiment/process/src/app/experiment-composition.build.ts`
  -> `modules/experiment/process/src/repositories/prisma/prisma.experiment-people.repository.ts`
- `modules/experiment/process/src/rules/experiment-run-input.rules.ts`
  -> `modules/experiment/process/src/services/experiment-cell-execution.service.ts`
- `modules/experiment/process/src/rules/experiment-run-input.rules.ts`
  -> `modules/experiment/process/src/services/experiment-connected-cell.service.ts`
- `modules/experiment/process/src/rules/experiment-run-input.rules.ts`
  -> `modules/experiment/process/src/services/experiment-run-driver.service.ts`
- `modules/experiment/process/src/rules/experiment-run-input.rules.ts`
  -> `modules/experiment/process/src/services/experiment-run-orchestrator.service.ts`
- `modules/experiment/process/src/services/experiment-comparison-plan.service.ts`
  -> `modules/experiment/process/src/services/experiment-comparison-variant.service.ts`
- `modules/experiment/process/src/services/experiment-connected-cell.service.ts`
  -> `modules/experiment/process/src/services/experiment-cell-execution.service.ts`
- ...and 6 more

### modules/ops/process -> modules/ops/process (13)

- `modules/ops/process/src/app/ops-composition.build.ts`
  -> `modules/ops/process/src/app/ops-operations.ts`
- `modules/ops/process/src/app/ops-composition.build.ts`
  -> `modules/ops/process/src/app/ops.app.ts`
- `modules/ops/process/src/app/ops-composition.build.ts`
  -> `modules/ops/process/src/repositories/redis/redis.ops-snapshot.repository.ts`
- `modules/ops/process/src/app/ops-composition.build.ts`
  -> `modules/ops/process/src/services/event-explorer.service.ts`
- `modules/ops/process/src/app/ops-composition.build.ts`
  -> `modules/ops/process/src/services/eventing.ops-introspection.service.ts`
- `modules/ops/process/src/app/ops-composition.build.ts`
  -> `modules/ops/process/src/services/manager-explorer.service.ts`
- `modules/ops/process/src/app/ops-composition.build.ts`
  -> `modules/ops/process/src/services/scheduler-wake.service.ts`
- `modules/ops/process/src/app/ops-operations.ts`
  -> `modules/ops/process/src/app/ops.app.ts`
- ...and 5 more

### modules/scenario/process -> modules/scenario/process (13)

- `modules/scenario/process/src/app/scenario-composition.build.ts`
  -> `modules/scenario/process/src/app/scenario.app.ts`
- `modules/scenario/process/src/app/scenario.app.ts`
  -> `modules/scenario/process/src/services/agent-test.service.ts`
- `modules/scenario/process/src/app/scenario.app.ts`
  -> `modules/scenario/process/src/services/scenario-execution-pool.service.ts`
- `modules/scenario/process/src/app/scenario.app.ts`
  -> `modules/scenario/process/src/services/scenario.service.ts`
- `modules/scenario/process/src/services/agent-test-prefetch.service.ts`
  -> `modules/scenario/process/src/services/scenario-execution-prefetcher.service.ts`
- `modules/scenario/process/src/services/agent-test.service.ts`
  -> `modules/scenario/process/src/services/scenario-execution-prefetcher.service.ts`
- `modules/scenario/process/src/services/scenario-execution-lookup.service.ts`
  -> `modules/scenario/process/src/services/scenario.service.ts`
- `modules/scenario/process/src/services/scenario-execution-prefetcher.service.ts`
  -> `modules/scenario/process/src/services/scenario-execution-lookup.service.ts`
- ...and 5 more

### modules/experiment/contract -> modules/workflow/contract (12)

- `modules/experiment/contract/src/experiment-workbench.ts`
  -> `modules/workflow/contract/src/index.ts`
- `modules/experiment/contract/src/experiment.api.ts`
  -> `modules/workflow/contract/src/index.ts`
- `modules/experiment/contract/src/experiment.responses.ts`
  -> `modules/workflow/contract/src/index.ts`
- `modules/experiment/contract/src/experiment.trpc.ts`
  -> `modules/workflow/contract/src/index.ts`
- `modules/experiment/contract/src/workbench/actions/schemas.ts`
  -> `modules/workflow/contract/src/index.ts`
- `modules/experiment/contract/src/workbench/actions/transforms/add-evaluator.ts`
  -> `modules/workflow/contract/src/index.ts`
- `modules/experiment/contract/src/workbench/actions/transforms/add-target.ts`
  -> `modules/workflow/contract/src/index.ts`
- `modules/experiment/contract/src/workbench/actions/transforms/set-target-prompt.ts`
  -> `modules/workflow/contract/src/index.ts`
- ...and 4 more

### packages/api -> packages/api (12)

- `packages/api/src/rest/addressing.ts`
  -> `packages/api/src/rest/declaration.ts`
- `packages/api/src/rest/declaration.ts`
  -> `packages/api/src/rest/idempotency.ts`
- `packages/api/src/rest/declaration.ts`
  -> `packages/api/src/rest/openapi.ts`
- `packages/api/src/rest/declaration.ts`
  -> `packages/api/src/rest/request.ts`
- `packages/api/src/rest/openapi.ts`
  -> `packages/api/src/rest/request.ts`
- `packages/api/src/rest/request.ts`
  -> `packages/api/src/rest/runtime.ts`
- `packages/api/src/rest/runtime.ts`
  -> `packages/api/src/rest/addressing.ts`
- `packages/api/src/rest/runtime.ts`
  -> `packages/api/src/rest/declaration.ts`
- ...and 4 more

### packages/eventing -> packages/eventing (12)

- `packages/eventing/src/index.ts`
  -> `packages/eventing/src/pipeline/staticBuilder.ts`
- `packages/eventing/src/pipeline/staticBuilder.types.ts`
  -> `packages/eventing/src/pipeline/types.ts`
- `packages/eventing/src/pipeline/types.ts`
  -> `packages/eventing/src/services/commands/commandDispatcher.ts`
- `packages/eventing/src/pipeline/types.ts`
  -> `packages/eventing/src/services/eventSourcingService.ts`
- `packages/eventing/src/pipeline/types.ts`
  -> `packages/eventing/src/services/queues/queueManager.ts`
- `packages/eventing/src/projections/projectionRegistry.ts`
  -> `packages/eventing/src/projections/projectionRouter.ts`
- `packages/eventing/src/queues/index.ts`
  -> `packages/eventing/src/queues/memory.ts`
- `packages/eventing/src/services/eventSourcingService.ts`
  -> `packages/eventing/src/projections/projectionRouter.ts`
- ...and 4 more

### modules/api-key/process -> modules/api-key/process (11)

- `modules/api-key/process/src/services/api-key-catalog.service.ts`
  -> `modules/api-key/process/src/services/api-key.service.ts`
- `modules/api-key/process/src/services/api-key-cli.service.ts`
  -> `modules/api-key/process/src/services/api-key-grant-policy.service.ts`
- `modules/api-key/process/src/services/api-key-cli.service.ts`
  -> `modules/api-key/process/src/services/api-key-lifecycle.service.ts`
- `modules/api-key/process/src/services/api-key-cli.service.ts`
  -> `modules/api-key/process/src/services/api-key.service.ts`
- `modules/api-key/process/src/services/api-key-enrichment.service.ts`
  -> `modules/api-key/process/src/services/api-key-catalog.service.ts`
- `modules/api-key/process/src/services/api-key-enrichment.service.ts`
  -> `modules/api-key/process/src/services/api-key.service.ts`
- `modules/api-key/process/src/services/api-key-grant-policy.service.ts`
  -> `modules/api-key/process/src/services/api-key.service.ts`
- `modules/api-key/process/src/services/api-key-lifecycle.service.ts`
  -> `modules/api-key/process/src/services/api-key-grant-policy.service.ts`
- ...and 3 more

### modules/dataset/process -> modules/dataset/process (11)

- `modules/dataset/process/src/app/dataset.app.ts`
  -> `modules/dataset/process/src/services/dataset-content.service.ts`
- `modules/dataset/process/src/app/dataset.app.ts`
  -> `modules/dataset/process/src/services/dataset-normalization.service.ts`
- `modules/dataset/process/src/app/dataset.app.ts`
  -> `modules/dataset/process/src/services/dataset-normalize.service.ts`
- `modules/dataset/process/src/app/dataset.app.ts`
  -> `modules/dataset/process/src/services/dataset-upload.service.ts`
- `modules/dataset/process/src/app/dataset.app.ts`
  -> `modules/dataset/process/src/services/dataset.service.ts`
- `modules/dataset/process/src/services/dataset-chunk-writer.service.ts`
  -> `modules/dataset/process/src/app/dataset.app.ts`
- `modules/dataset/process/src/services/dataset-chunk.service.ts`
  -> `modules/dataset/process/src/app/dataset.app.ts`
- `modules/dataset/process/src/services/dataset-chunk.service.ts`
  -> `modules/dataset/process/src/services/dataset-chunk-delete.service.ts`
- ...and 3 more

### modules/prompt/process -> modules/prompt/process (11)

- `modules/prompt/process/src/repositories/memory/memory.prompt-version.repository.ts`
  -> `modules/prompt/process/src/repositories/memory/memory.prompt.repository.ts`
- `modules/prompt/process/src/repositories/prisma/prisma.prompt-version.repository.ts`
  -> `modules/prompt/process/src/repositories/prisma/prisma.prompt.repository.ts`
- `modules/prompt/process/src/services/prompt-copy.service.ts`
  -> `modules/prompt/process/src/services/prompt-read.service.ts`
- `modules/prompt/process/src/services/prompt-copy.service.ts`
  -> `modules/prompt/process/src/services/prompt-write.service.ts`
- `modules/prompt/process/src/services/prompt-copy.service.ts`
  -> `modules/prompt/process/src/services/prompt.service.ts`
- `modules/prompt/process/src/services/prompt-read.service.ts`
  -> `modules/prompt/process/src/services/prompt.service.ts`
- `modules/prompt/process/src/services/prompt-sync.service.ts`
  -> `modules/prompt/process/src/services/prompt-read.service.ts`
- `modules/prompt/process/src/services/prompt-sync.service.ts`
  -> `modules/prompt/process/src/services/prompt-write.service.ts`
- ...and 3 more

### modules/trace/browser -> modules/trace/browser (10)

- `modules/trace/browser/src/ui/sections/explorer/trace-table/columns.ts`
  -> `modules/trace/browser/src/ui/sections/explorer/trace-table/registry/index.ts`
- `modules/trace/browser/src/ui/sections/explorer/trace-table/columns.ts`
  -> `modules/trace/browser/src/ui/sections/explorer/trace-table/trace-table-shell.tsx`
- `modules/trace/browser/src/ui/sections/explorer/trace-table/registry/addons/conversation/compact-turns.tsx`
  -> `modules/trace/browser/src/ui/sections/explorer/trace-table/registry/cells/select-cells.tsx`
- `modules/trace/browser/src/ui/sections/explorer/trace-table/registry/addons/conversation/compact-turns.tsx`
  -> `modules/trace/browser/src/ui/sections/explorer/trace-table/trace-table-shell.tsx`
- `modules/trace/browser/src/ui/sections/explorer/trace-table/registry/cells/conversation/index.ts`
  -> `modules/trace/browser/src/ui/sections/explorer/trace-table/registry/cells/select-cells.tsx`
- `modules/trace/browser/src/ui/sections/explorer/trace-table/registry/cells/group/index.ts`
  -> `modules/trace/browser/src/ui/sections/explorer/trace-table/registry/cells/select-cells.tsx`
- `modules/trace/browser/src/ui/sections/explorer/trace-table/registry/cells/trace/index.ts`
  -> `modules/trace/browser/src/ui/sections/explorer/trace-table/registry/cells/select-cells.tsx`
- `modules/trace/browser/src/ui/sections/explorer/trace-table/registry/index.ts`
  -> `modules/trace/browser/src/ui/sections/explorer/trace-table/registry/registry-row.tsx`
- ...and 2 more

### modules/feature-flag/process -> modules/feature-flag/process (7)

- `modules/feature-flag/process/src/app/feature-flag.app.ts`
  -> `modules/feature-flag/process/src/repositories/feature-flag.repositories.ts`
- `modules/feature-flag/process/src/app/feature-flag.app.ts`
  -> `modules/feature-flag/process/src/services/cached-feature-flag-row.service.ts`
- `modules/feature-flag/process/src/app/feature-flag.app.ts`
  -> `modules/feature-flag/process/src/services/feature-flag.service.ts`
- `modules/feature-flag/process/src/app/feature-flag.app.ts`
  -> `modules/feature-flag/process/src/services/uncached-feature-flag-cache.service.ts`
- `modules/feature-flag/process/src/services/cached-feature-flag-row.service.ts`
  -> `modules/feature-flag/process/src/repositories/feature-flag.repository.ts`
- `modules/feature-flag/process/src/services/cached-feature-flag-row.service.ts`
  -> `modules/feature-flag/process/src/stores/feature-flag-row.store.ts`
- `modules/feature-flag/process/src/services/feature-flag.service.ts`
  -> `modules/feature-flag/process/src/stores/feature-flag-row.store.ts`

### modules/coding-agent/contract -> modules/coding-agent/contract (6)

- `modules/coding-agent/contract/src/coding-agent-transcript-codex.ts`
  -> `modules/coding-agent/contract/src/coding-agent-transcript-state.ts`
- `modules/coding-agent/contract/src/coding-agent-transcript-log.ts`
  -> `modules/coding-agent/contract/src/coding-agent-transcript-note.ts`
- `modules/coding-agent/contract/src/coding-agent-transcript-log.ts`
  -> `modules/coding-agent/contract/src/coding-agent-transcript-state.ts`
- `modules/coding-agent/contract/src/coding-agent-transcript-log.ts`
  -> `modules/coding-agent/contract/src/coding-agent-transcript.ts`
- `modules/coding-agent/contract/src/coding-agent-transcript-span.ts`
  -> `modules/coding-agent/contract/src/coding-agent-transcript-state.ts`
- `modules/coding-agent/contract/src/coding-agent-transcript-state.ts`
  -> `modules/coding-agent/contract/src/coding-agent-transcript.ts`

### modules/langy/process -> modules/langy/process (6)

- `modules/langy/process/src/repositories/langy-repositories.registry.ts`
  -> `modules/langy/process/src/repositories/memory/memory.langy.repositories.ts`
- `modules/langy/process/src/repositories/langy-repositories.registry.ts`
  -> `modules/langy/process/src/repositories/prisma/prisma.langy.repositories.ts`
- `modules/langy/process/src/services/langy-conversation-lifecycle.service.ts`
  -> `modules/langy/process/src/services/langy-conversation.service.ts`
- `modules/langy/process/src/services/langy-conversation-read.service.ts`
  -> `modules/langy/process/src/services/langy-conversation.service.ts`
- `modules/langy/process/src/services/langy-conversation-turn.service.ts`
  -> `modules/langy/process/src/services/langy-conversation.service.ts`
- `modules/langy/process/src/services/langy-internal.service.ts`
  -> `modules/langy/process/src/services/prometheus.langy-rest-metrics.service.ts`

### modules/trace/contract -> modules/trace/contract (6)

- `modules/trace/contract/src/index.ts`
  -> `modules/trace/contract/src/spans.trpc.ts`
- `modules/trace/contract/src/index.ts`
  -> `modules/trace/contract/src/trace-edit-overlay.trpc.ts`
- `modules/trace/contract/src/index.ts`
  -> `modules/trace/contract/src/trace-list-view.ts`
- `modules/trace/contract/src/index.ts`
  -> `modules/trace/contract/src/trace.responses.ts`
- `modules/trace/contract/src/trace-edit-overlay.trpc.ts`
  -> `modules/trace/contract/src/trace.responses.ts`
- `modules/trace/contract/src/trace.responses.ts`
  -> `modules/trace/contract/src/trace-list-view.ts`

### modules/agent/process -> modules/agent/process (5)

- `modules/agent/process/src/rules/connected-agent-instance-selection.rules.ts`
  -> `modules/agent/process/src/services/connected-agent-runtime.service.ts`
- `modules/agent/process/src/services/connected-agent-dispatch.service.ts`
  -> `modules/agent/process/src/services/connected-agent-registry.service.ts`
- `modules/agent/process/src/services/connected-agent-dispatch.service.ts`
  -> `modules/agent/process/src/services/connected-agent-runtime.service.ts`
- `modules/agent/process/src/services/connected-agent-registration.service.ts`
  -> `modules/agent/process/src/services/connected-agent-session.service.ts`
- `modules/agent/process/src/services/connected-agent-registry.service.ts`
  -> `modules/agent/process/src/services/connected-agent-runtime.service.ts`

### modules/data-retention/process -> modules/data-retention/process (5)

- `modules/data-retention/process/src/app/data-retention.app.ts`
  -> `modules/data-retention/process/src/services/data-retention-policy.service.ts`
- `modules/data-retention/process/src/app/data-retention.app.ts`
  -> `modules/data-retention/process/src/services/data-retention-snapshot.service.ts`
- `modules/data-retention/process/src/app/data-retention.app.ts`
  -> `modules/data-retention/process/src/services/storage-meter-scope.service.ts`
- `modules/data-retention/process/src/services/data-retention-snapshot.service.ts`
  -> `modules/data-retention/process/src/services/data-retention-policy.service.ts`
- `modules/data-retention/process/src/services/storage-meter-scope.service.ts`
  -> `modules/data-retention/process/src/services/data-retention-policy.service.ts`

### modules/organization/process -> modules/organization/process (5)

- `modules/organization/process/src/app/organization-composition.build.ts`
  -> `modules/organization/process/src/app/organization.app.ts`
- `modules/organization/process/src/services/invite-acceptance.service.ts`
  -> `modules/organization/process/src/services/invite.service.ts`
- `modules/organization/process/src/services/invite-creation.service.ts`
  -> `modules/organization/process/src/services/invite.service.ts`
- `modules/organization/process/src/services/invite-lifecycle.service.ts`
  -> `modules/organization/process/src/services/invite-creation.service.ts`
- `modules/organization/process/src/services/organization-group-binding.service.ts`
  -> `modules/organization/process/src/services/organization-group.service.ts`

### modules/suite/process -> modules/suite/process (5)

- `modules/suite/process/src/app/suite-composition.build.ts`
  -> `modules/suite/process/src/app/suite.app.ts`
- `modules/suite/process/src/app/suite.app.ts`
  -> `modules/suite/process/src/services/suite.service.ts`
- `modules/suite/process/src/services/suite-run-scope.service.ts`
  -> `modules/suite/process/src/services/suite.service.ts`
- `modules/suite/process/src/services/suite-run.service.ts`
  -> `modules/suite/process/src/app/suite.app.ts`
- `modules/suite/process/src/services/suite-run.service.ts`
  -> `modules/suite/process/src/services/suite.service.ts`

### modules/webhook/process -> modules/webhook/process (5)

- `modules/webhook/process/src/app/webhook-composition.build.ts`
  -> `modules/webhook/process/src/app/webhook.app.ts`
- `modules/webhook/process/src/app/webhook.app.ts`
  -> `modules/webhook/process/src/repositories/webhook-endpoint.repository.ts`
- `modules/webhook/process/src/app/webhook.app.ts`
  -> `modules/webhook/process/src/repositories/webhook.repositories.ts`
- `modules/webhook/process/src/services/webhook-batch-send.service.ts`
  -> `modules/webhook/process/src/services/webhook-delivery.service.ts`
- `modules/webhook/process/src/services/webhook-delivery-maintenance.service.ts`
  -> `modules/webhook/process/src/services/webhook-delivery.service.ts`

### enterprise/modules/governance/process -> enterprise/modules/governance/process (4)

- `enterprise/modules/governance/process/src/app/governance-member-infrastructure.ts`
  -> `enterprise/modules/governance/process/src/app/governance.app.ts`
- `enterprise/modules/governance/process/src/channels/copilot-studio-dataverse.channel.ts`
  -> `enterprise/modules/governance/process/src/channels/http/http.copilot-studio-dataverse.channel.ts`
- `enterprise/modules/governance/process/src/repositories/clickhouse/clickhouse.ocsf-events.repository.ts`
  -> `enterprise/modules/governance/process/src/repositories/governance.repositories.ts`
- `enterprise/modules/governance/process/src/rules/genie-span-attributes-service.rules.ts`
  -> `enterprise/modules/governance/process/src/rules/genie-trace-mapper-service.rules.ts`

### modules/authz/process -> modules/authz/process (4)

- `modules/authz/process/src/app/authz.app.ts`
  -> `modules/authz/process/src/app/postgres-authz.build.ts`
- `modules/authz/process/src/app/postgres-authz.build.ts`
  -> `modules/authz/process/src/repositories/eventing/eventing.authz-grant.repository.ts`
- `modules/authz/process/src/app/postgres-authz.build.ts`
  -> `modules/authz/process/src/services/authz-grants.service.ts`
- `modules/authz/process/src/services/authz-binding-writer.service.ts`
  -> `modules/authz/process/src/app/authz.app.ts`

### modules/evaluator/browser -> modules/evaluator/browser (4)

- `modules/evaluator/browser/src/ui/sections/checks/check-config-form.tsx`
  -> `modules/evaluator/browser/src/ui/sections/checks/dynamic-zod-form.tsx`
- `modules/evaluator/browser/src/ui/sections/checks/check-config-form.tsx`
  -> `modules/evaluator/browser/src/ui/sections/checks/evaluation-manual-integration.tsx`
- `modules/evaluator/browser/src/ui/sections/checks/check-config-form.tsx`
  -> `modules/evaluator/browser/src/ui/sections/checks/evaluator-selection.tsx`
- `modules/evaluator/browser/src/ui/sections/checks/check-config-form.tsx`
  -> `modules/evaluator/browser/src/ui/sections/checks/try-it-out.tsx`

### modules/presence/process -> modules/presence/process (4)

- `modules/presence/process/src/app/presence.app.ts`
  -> `modules/presence/process/src/repositories/redis/redis.broadcast.repository.ts`
- `modules/presence/process/src/app/presence.app.ts`
  -> `modules/presence/process/src/services/presence-stream.service.ts`
- `modules/presence/process/src/app/presence.app.ts`
  -> `modules/presence/process/src/services/presence.service.ts`
- `modules/presence/process/src/services/presence-stream.service.ts`
  -> `modules/presence/process/src/services/presence.service.ts`

### packages/browser-host -> packages/browser-host (4)

- `packages/browser-host/src/analytics.ts`
  -> `packages/browser-host/src/capabilities.ts`
- `packages/browser-host/src/capabilities.ts`
  -> `packages/browser-host/src/scope.ts`
- `packages/browser-host/src/capabilities.ts`
  -> `packages/browser-host/src/session.ts`
- `packages/browser-host/src/capabilities.ts`
  -> `packages/browser-host/src/slots.tsx`

### enterprise/modules/licensing/contract -> enterprise/modules/licensing/contract (3)

- `enterprise/modules/licensing/contract/src/index.ts`
  -> `enterprise/modules/licensing/contract/src/license-enforcement.errors.ts`
- `enterprise/modules/licensing/contract/src/index.ts`
  -> `enterprise/modules/licensing/contract/src/license-limit-labels.ts`
- `enterprise/modules/licensing/contract/src/license-enforcement.errors.ts`
  -> `enterprise/modules/licensing/contract/src/license-limit-labels.ts`

### modules/analytics/contract -> modules/analytics/contract (3)

- `modules/analytics/contract/src/analytics-rest.schemas.ts`
  -> `modules/analytics/contract/src/analytics.input-schemas.ts`
- `modules/analytics/contract/src/analytics.input-schemas.ts`
  -> `modules/analytics/contract/src/index.ts`
- `modules/analytics/contract/src/analytics.trpc.ts`
  -> `modules/analytics/contract/src/analytics.input-schemas.ts`

### modules/automation/process -> modules/automation/process (3)

- `modules/automation/process/src/app/automation-composition.build.ts`
  -> `modules/automation/process/src/app/automation.app.ts`
- `modules/automation/process/src/app/automation.app.ts`
  -> `modules/automation/process/src/services/automation-authoring.service.ts`
- `modules/automation/process/src/services/automation-graph-runtime.service.ts`
  -> `modules/automation/process/src/services/graph-trigger-heartbeat.service.ts`

### modules/dataset/browser -> modules/dataset/browser (3)

- `modules/dataset/browser/src/ui/sections/datasets/add-or-edit-dataset-drawer.tsx`
  -> `modules/dataset/browser/src/ui/sections/datasets/editor/dataset-editor-table.tsx`
- `modules/dataset/browser/src/ui/sections/datasets/add-rows-from-csv-modal.tsx`
  -> `modules/dataset/browser/src/ui/sections/datasets/upload-csv-drawer.tsx`
- `modules/dataset/browser/src/ui/sections/datasets/editor/dataset-editor-table.tsx`
  -> `modules/dataset/browser/src/ui/sections/datasets/add-rows-from-csv-modal.tsx`

### modules/evaluation/contract -> modules/evaluation/contract (3)

- `modules/evaluation/contract/src/evaluation.api.ts`
  -> `modules/evaluation/contract/src/evaluation-rest.schemas.ts`
- `modules/evaluation/contract/src/index.ts`
  -> `modules/evaluation/contract/src/evaluation-rest.schemas.ts`
- `modules/evaluation/contract/src/index.ts`
  -> `modules/evaluation/contract/src/evaluation.api.ts`

### modules/metric/process -> modules/metric/process (3)

- `modules/metric/process/src/eventing/metric-data-point-storage.projection.ts`
  -> `modules/metric/process/src/services/metric-processing.service.ts`
- `modules/metric/process/src/eventing/metric-series-catalog.projection.ts`
  -> `modules/metric/process/src/services/metric-processing.service.ts`
- `modules/metric/process/src/eventing/metric-time-rollup.projection.ts`
  -> `modules/metric/process/src/services/metric-processing.service.ts`

### modules/stored-object/process -> modules/stored-object/process (3)

- `modules/stored-object/process/src/app/stored-object-composition.build.ts`
  -> `modules/stored-object/process/src/app/stored-object.app.ts`
- `modules/stored-object/process/src/rules/object-storage-migration-transfer.rules.ts`
  -> `modules/stored-object/process/src/services/object-storage-migration.service.ts`
- `modules/stored-object/process/src/services/stored-object-upload.service.ts`
  -> `modules/stored-object/process/src/services/stored-object.service.ts`

### packages/kernel -> packages/kernel (3)

- `packages/kernel/src/feature-installer.ts`
  -> `packages/kernel/src/module-eventing.ts`
- `packages/kernel/src/feature-installer.ts`
  -> `packages/kernel/src/transport-mounting.ts`
- `packages/kernel/src/resource-scope.ts`
  -> `packages/kernel/src/runtime-lifecycle.ts`

### enterprise/modules/billing/process -> enterprise/modules/billing/process (2)

- `enterprise/modules/billing/process/src/channels/memory/memory.usage-limit-email.channel.ts`
  -> `enterprise/modules/billing/process/src/channels/usage-limit-email.channel.ts`
- `enterprise/modules/billing/process/src/channels/usage-limit-email.channel.ts`
  -> `enterprise/modules/billing/process/src/services/billing-usage-notice.service.ts`

### modules/analytics/browser -> modules/analytics/browser (2)

- `modules/analytics/browser/src/ui/sections/analytics/utils.ts`
  -> `modules/analytics/browser/src/ui/sections/use-filter-params.ts`
- `modules/analytics/browser/src/ui/sections/draggable-graph-card.tsx`
  -> `modules/analytics/browser/src/ui/sections/use-draggable-graph-card.ts`

### modules/annotation/contract -> modules/annotation/contract (2)

- `modules/annotation/contract/src/annotation.api.ts`
  -> `modules/annotation/contract/src/annotation-review.schemas.ts`
- `modules/annotation/contract/src/annotation.trpc.ts`
  -> `modules/annotation/contract/src/annotation-review.schemas.ts`

### modules/automation/contract -> modules/automation/contract (2)

- `modules/automation/contract/src/automation.api.ts`
  -> `modules/automation/contract/src/automation.responses.ts`
- `modules/automation/contract/src/automation.trpc.ts`
  -> `modules/automation/contract/src/automation.responses.ts`

### modules/automation/contract -> modules/monitor/contract (2)

- `modules/automation/contract/src/automation.api.ts`
  -> `modules/monitor/contract/src/index.ts`
- `modules/automation/contract/src/automation.responses.ts`
  -> `modules/monitor/contract/src/index.ts`

### modules/data-privacy/process -> modules/data-privacy/process (2)

- `modules/data-privacy/process/src/app/data-privacy.app.ts`
  -> `modules/data-privacy/process/src/services/data-privacy-scope-authorization.service.ts`
- `modules/data-privacy/process/src/app/data-privacy.app.ts`
  -> `modules/data-privacy/process/src/services/data-privacy-snapshot.service.ts`

### modules/experiment/browser -> modules/experiment/browser (2)

- `modules/experiment/browser/src/model/batch-evaluation-results.bt-leaderboard.ts`
  -> `modules/experiment/browser/src/model/batch-evaluation-results.comparability.ts`
- `modules/experiment/browser/src/ui/sections/batch-evaluation-results.types.ts`
  -> `modules/experiment/browser/src/ui/sections/batch-results/presentation.tsx`

### modules/experiment/contract -> modules/dataset/contract (2)

- `modules/experiment/contract/src/experiment-workbench.ts`
  -> `modules/dataset/contract/src/index.ts`
- `modules/experiment/contract/src/experiment.api.ts`
  -> `modules/dataset/contract/src/index.ts`

### modules/monitor/process -> modules/monitor/process (2)

- `modules/monitor/process/src/app/monitor-composition.build.ts`
  -> `modules/monitor/process/src/app/monitor.app.ts`
- `modules/monitor/process/src/app/monitor.app.ts`
  -> `modules/monitor/process/src/services/monitor.service.ts`

### modules/suite/contract -> modules/suite/contract (2)

- `modules/suite/contract/src/index.ts`
  -> `modules/suite/contract/src/suite.api.ts`
- `modules/suite/contract/src/suite-run.event-guards.ts`
  -> `modules/suite/contract/src/suite-run.events.ts`

### modules/topic/process -> modules/topic/process (2)

- `modules/topic/process/src/app/topic.app.ts`
  -> `modules/topic/process/src/services/topic-clustering-schedule.service.ts`
- `modules/topic/process/src/app/topic.app.ts`
  -> `modules/topic/process/src/services/topic.service.ts`

### modules/trace/contract -> modules/evaluation/contract (2)

- `modules/trace/contract/src/trace-list-view.ts`
  -> `modules/evaluation/contract/src/index.ts`
- `modules/trace/contract/src/trace.responses.ts`
  -> `modules/evaluation/contract/src/index.ts`

### enterprise/modules/governance/browser -> enterprise/modules/governance/browser (1)

- `enterprise/modules/governance/browser/src/features/source-events/ui/sections/source-event-detail-panels.tsx`
  -> `enterprise/modules/governance/browser/src/features/source-events/ui/sections/source-events-table.tsx`

### enterprise/modules/licensing/process -> enterprise/modules/licensing/process (1)

- `enterprise/modules/licensing/process/src/app/licensing.app.ts`
  -> `enterprise/modules/licensing/process/src/services/licensing-infrastructure.service.ts`

### modules/analytics/process -> modules/analytics/process (1)

- `modules/analytics/process/src/repositories/clickhouse/clickhouse.filter-shapes.mapper.ts`
  -> `modules/analytics/process/src/repositories/filter-options.repository.ts`

### modules/annotation/contract -> modules/trace/contract (1)

- `modules/annotation/contract/src/annotation-review.schemas.ts`
  -> `modules/trace/contract/src/index.ts`

### modules/dataset/contract -> modules/dataset/contract (1)

- `modules/dataset/contract/src/index.ts`
  -> `modules/dataset/contract/src/trace-mapping.ts`

### modules/dataset/contract -> modules/trace/contract (1)

- `modules/dataset/contract/src/trace-mapping.ts`
  -> `modules/trace/contract/src/index.ts`

### modules/entitlement/process -> modules/entitlement/process (1)

- `modules/entitlement/process/src/app/entitlement-composition.build.ts`
  -> `modules/entitlement/process/src/app/entitlement.app.ts`

### modules/evaluation/process -> modules/evaluation/process (1)

- `modules/evaluation/process/src/services/evaluation-data.service.ts`
  -> `modules/evaluation/process/src/services/evaluation-execution.service.ts`

### modules/evaluator/process -> modules/evaluator/process (1)

- `modules/evaluator/process/src/app/evaluator.app.ts`
  -> `modules/evaluator/process/src/repositories/prisma/prisma.evaluator-graph.repository.ts`

### modules/gateway/process -> modules/gateway/process (1)

- `modules/gateway/process/src/app/gateway-composition.build.ts`
  -> `modules/gateway/process/src/app/gateway.app.ts`

### modules/langy/contract -> modules/langy/contract (1)

- `modules/langy/contract/src/event-sourcing/contracts/ephemeral.ts`
  -> `modules/langy/contract/src/index.ts`

### modules/model-provider/process -> modules/model-provider/process (1)

- `modules/model-provider/process/src/app/model-provider-composition.build.ts`
  -> `modules/model-provider/process/src/app/model-provider.app.ts`

### modules/monitor/contract -> modules/monitor/contract (1)

- `modules/monitor/contract/src/index.ts`
  -> `modules/monitor/contract/src/monitor.trpc.ts`

### modules/monitor/contract -> modules/evaluation/contract (1)

- `modules/monitor/contract/src/monitor.trpc.ts`
  -> `modules/evaluation/contract/src/index.ts`

### modules/project/process -> modules/project/process (1)

- `modules/project/process/src/services/project-metadata.service.ts`
  -> `modules/project/process/src/services/project.service.ts`

### modules/prompt/browser -> modules/prompt/browser (1)

- `modules/prompt/browser/src/behavior/playground/use-conversation-state.ts`
  -> `modules/prompt/browser/src/behavior/playground/use-prompt-execution.ts`

### modules/scenario/contract -> modules/workflow/contract (1)

- `modules/scenario/contract/src/evaluator-attachments.ts`
  -> `modules/workflow/contract/src/index.ts`

### modules/secret/process -> modules/secret/process (1)

- `modules/secret/process/src/app/secret.app.ts`
  -> `modules/secret/process/src/services/secret.service.ts`

### modules/trace/browser-kit -> modules/trace/browser-kit (1)

- `modules/trace/browser-kit/src/lens-capabilities.ts`
  -> `modules/trace/browser-kit/src/view.store.ts`

### modules/workflow/browser -> modules/workflow/browser (1)

- `modules/workflow/browser/src/ui/sections/optimization_studio/history.tsx`
  -> `modules/workflow/browser/src/ui/sections/optimization_studio/version-to-be-used.tsx`

### modules/workflow/contract -> modules/dataset/contract (1)

- `modules/workflow/contract/src/dataset-transposition.ts`
  -> `modules/dataset/contract/src/index.ts`

### packages/group-queue -> packages/group-queue (1)

- `packages/group-queue/src/jobEnvelope.ts`
  -> `packages/group-queue/src/tieredBlobStore.ts`

### packages/ksuid -> packages/ksuid (1)

- `packages/ksuid/src/instance.ts`
  -> `packages/ksuid/src/validation.ts`

### packages/process-server -> packages/process-server (1)

- `packages/process-server/src/hosted-runtime.ts`
  -> `packages/process-server/src/server.ts`

### packages/ui-kernel -> packages/ui-kernel (1)

- `packages/ui-kernel/src/ui-supply.types.ts`
  -> `packages/ui-kernel/src/web-module.ts`

