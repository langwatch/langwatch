# scenarios audit manifest

Phase 0 audit of every unimplemented-tagged scenario under `specs/scenarios/` (214 across 19 files).

Tracking: https://github.com/langwatch/langwatch/issues/3458

## TL;DR

| Class | Count | % | Phase 1 action |
|-------|------:|--:|----------------|
| KEEP | 63 | 29% | Phase 3: write test |
| UPDATE | 16 | 7% | Phase 1: rewrite scenario |
| DELETE | 10 | 5% | Phase 1: remove from spec |
| DUPLICATE | 125 | 58% | Phase 1: remove + cross-link |
| **Total** | **214** | **100%** | |

## Headline finding

**58% of the unimplemented-tagged scenarios in `specs/scenarios/` are mistagged**: the behavior is already covered by an existing test that just isn't bound via `@scenario` JSDoc. The bulk-tagging pass that applied the tag everywhere did not cross-check existing test coverage.

Concentrations:
- `scenario-deletion.feature` — 23/25 already covered (`scenario-archive.integration.test.ts`, `ScenarioTable.integration.test.tsx`, `useScenarioSelection.integration.test.ts`).
- `simulation-runner.feature` — most scenarios duplicated by `simulation-runner.router.unit.test.ts`, `scenario.processor.*.integration.test.ts`, `orchestrator.unit.test.ts`.
- `internal-set-namespace.feature` & `stalled-scenario-runs.feature` — heavy DUPLICATE overlap with `internal-set-id.unit.test.ts`, `stall-detection*.test.ts`, `stalled-status-display.integration.test.ts`.

## Notable individual findings

- **`scenario-job-id-uniqueness.feature` is wholly obsolete**: the cited `scheduleScenarioRun()` and the `scenario_${projectId}_${scenarioId}_${batchRunId}` formula no longer exist. Job IDs are now `${tenantId}:${scenarioRunId}:queue-run` keyed by a pre-generated KSUID. The whole file is DELETE.
- **Stall threshold drift**: spec says 10 minutes, code uses 30 minutes (2× `CHILD_PROCESS.TIMEOUT_MS=15min`). UPDATE.
- **Failure-handler emits only `finishRun`** (not `startRun + finishRun` as some scenarios describe). 3 scenarios → UPDATE.
- **Failure-handler timeout drift**: spec says 5 minutes, actual `CHILD_PROCESS.TIMEOUT_MS` is 15 minutes. UPDATE.
- **`AICreateModal` Skip button** is hidden when `!hasModelProviders` — contradicts "Manual scenario creation available despite no providers" scenario. DELETE.
- **`initialPrompt` URL parameter does not exist**; the modal passes data via `openDrawer` with `initialFormData`. DELETE.
- **Display name drift**: spec uses "On-Platform Scenarios" / "Manual Run", impl uses the other. Two UPDATE rows + two `it.skip` blocks already exist.
- **`scenario-failure-handler.feature` synthetic ID generation** scenarios → DELETE (no synthetic IDs are generated; KSUIDs assigned upfront).

## Per-file roll-up

| File | @unimpl | KEEP | UPDATE | DELETE | DUPLICATE |
|------|--------:|-----:|-------:|-------:|----------:|
| ai-create-modal.feature | 30 | 7 | 2 | 2 | 19 |
| event-driven-execution-prep.feature | 11 | 4 | 0 | 0 | 7 |
| internal-scenario-namespace.feature | 6 | 0 | 2 | 2 | 2 |
| internal-set-namespace.feature | 13 | 1 | 1 | 0 | 11 |
| model-params-error-feedback.feature | 12 | 10 | 0 | 0 | 2 |
| scenario-api.feature | 10 | 2 | 2 | 0 | 6 |
| scenario-bulk-actions.feature | 5 | 2 | 0 | 0 | 3 |
| scenario-deferred-persistence.feature | 5 | 1 | 0 | 0 | 4 |
| scenario-deletion.feature | 25 | 2 | 0 | 0 | 23 |
| scenario-drawer-close-on-save.feature | 4 | 0 | 1 | 0 | 3 |
| scenario-editor-new-agent-flow.feature | 7 | 3 | 0 | 0 | 4 |
| scenario-editor.feature | 10 | 3 | 0 | 0 | 7 |
| scenario-event-repository-tracing.feature | 1 | 0 | 0 | 0 | 1 |
| scenario-execution.feature | 11 | 11 | 0 | 0 | 0 |
| scenario-failure-handler.feature | 18 | 6 | 5 | 2 | 5 |
| scenario-job-id-uniqueness.feature | 4 | 0 | 0 | 4 | 0 |
| scenario-library.feature | 5 | 3 | 0 | 0 | 2 |
| simulation-runner.feature | 25 | 7 | 2 | 0 | 16 |
| stalled-scenario-runs.feature | 12 | 1 | 1 | 0 | 10 |

## Manifest

| File | Scenario | Class | Rationale |
|------|----------|-------|-----------|
| specs/scenarios/ai-create-modal.feature | "Open AI create modal from scenarios list" | KEEP | Modal exists at langwatch/src/components/scenarios/ScenarioCreateModal.tsx; no integration test covers full open-from-list flow yet |
| specs/scenarios/ai-create-modal.feature | "Generate scenario with AI using custom description" | KEEP | E2E flow described; modal calls /api/scenario/generate then opens drawer; no E2E test exists yet |
| specs/scenarios/ai-create-modal.feature | "Use example template to generate scenario" | KEEP | Pills exist (Customer Support, RAG Q&A, Tool-calling Agent in ScenarioCreateModal.tsx:32-45); no end-to-end test |
| specs/scenarios/ai-create-modal.feature | "Skip AI generation and create blank scenario" | UPDATE | handleSkip in ScenarioCreateModal.tsx:122-128 opens drawer with empty form; spec says "new empty scenario is created" but no DB record is created until save |
| specs/scenarios/ai-create-modal.feature | "Textarea allows unlimited text input" | DUPLICATE | Covered by AICreateModal.test.tsx:186-205 "allows unlimited text input" |
| specs/scenarios/ai-create-modal.feature | "Close modal with close button in default state" | KEEP | onClose handler exists; not directly tested in current ScenarioCreateModal.test.tsx |
| specs/scenarios/ai-create-modal.feature | "Modal is not dismissable during generation" | DUPLICATE | Covered by AICreateModal.test.tsx:338-365 "hides close button during generation" + handleOpenChange guard at AICreateModal.tsx:147-155 |
| specs/scenarios/ai-create-modal.feature | "Customer Support example fills textarea" | DUPLICATE | Covered by ScenarioCreateModal.test.tsx:210-225 |
| specs/scenarios/ai-create-modal.feature | "RAG Q&A example fills textarea" | DUPLICATE | Covered by ScenarioCreateModal.test.tsx:227-242 |
| specs/scenarios/ai-create-modal.feature | "Tool-calling Agent example fills textarea" | DUPLICATE | Covered by ScenarioCreateModal.test.tsx:244-259 |
| specs/scenarios/ai-create-modal.feature | "Display error state when generation fails" | DUPLICATE | Covered by AICreateModal.test.tsx:368-395 + 397-453 (error title, Try again, Skip, close button) |
| specs/scenarios/ai-create-modal.feature | "Retry generation after error" | DUPLICATE | Covered by AICreateModal.test.tsx:485-523 "when user clicks Try again retries generation" |
| specs/scenarios/ai-create-modal.feature | "Skip to blank editor from error state" | KEEP | onSkip is wired in ErrorFooter (AICreateModal.tsx:201) but no test covers skip-from-error full flow |
| specs/scenarios/ai-create-modal.feature | "Display error when API keys not configured" | UPDATE | Spec text "API keys not configured" is misleading per issue #2919 (ScenarioCreateModal.test.tsx:490); actual errors differ — rewrite |
| specs/scenarios/ai-create-modal.feature | "Warning replaces AI generation area when no model providers configured" | DUPLICATE | Covered by AICreateModal.test.tsx:609-727 "when hasModelProviders is false" suite |
| specs/scenarios/ai-create-modal.feature | "Warning message includes link to model provider settings" | DUPLICATE | Covered by AICreateModal.test.tsx:708-726 "renders link to model provider settings" |
| specs/scenarios/ai-create-modal.feature | "Navigate to model provider settings from warning" | KEEP | Link exists with href="/settings/model-providers"; navigation behavior not covered |
| specs/scenarios/ai-create-modal.feature | "Manual scenario creation available despite no providers" | DELETE | Contradicts implementation: AICreateModal.tsx:188-190 hides Skip button entirely when !hasModelProviders (test at AICreateModal.test.tsx:688-706 confirms) |
| specs/scenarios/ai-create-modal.feature | "Normal AI generation UI when model providers are configured" | DUPLICATE | Covered by AICreateModal.test.tsx:730-808 "when hasModelProviders is true" suite |
| specs/scenarios/ai-create-modal.feature | "Generation times out after 60 seconds" | DUPLICATE | Covered by AICreateModal.test.tsx:526-565 "when generation times out displays timeout error after 60 seconds" |
| specs/scenarios/ai-create-modal.feature | "Close modal from error state" | KEEP | showCloseButton logic at AICreateModal.tsx:157 allows close in error state; no integration test for close-from-error flow |
| specs/scenarios/ai-create-modal.feature | "Generated scenario passes prompt via URL parameter" | DELETE | Implementation uses openDrawer with initialFormData (ScenarioCreateModal.tsx:73-86), NOT URL params; grep finds no initialPrompt usage |
| specs/scenarios/ai-create-modal.feature | "AICreateModal accepts custom title prop" | DUPLICATE | Covered by AICreateModal.test.tsx:54-86 (default + custom title cases) |
| specs/scenarios/ai-create-modal.feature | "AICreateModal accepts custom placeholder prop" | DUPLICATE | Covered by AICreateModal.test.tsx:88-106 "displays textarea with custom placeholder" |
| specs/scenarios/ai-create-modal.feature | "AICreateModal calls onGenerate callback with description" | DUPLICATE | Covered by AICreateModal.test.tsx:255-281 "calls onGenerate with description" |
| specs/scenarios/ai-create-modal.feature | "AICreateModal calls onSkip callback" | DUPLICATE | Covered by AICreateModal.test.tsx:232-253 "calls onSkip callback" |
| specs/scenarios/ai-create-modal.feature | "AICreateModal transitions between states correctly" | DUPLICATE | State transitions covered across AICreateModal.test.tsx idle→generating→error→idle blocks |
| specs/scenarios/ai-create-modal.feature | "Example templates are configurable" | DUPLICATE | Covered by AICreateModal.test.tsx:108-125 + 208-230 (custom exampleTemplates prop, click fills textarea) |
| specs/scenarios/ai-create-modal.feature | "AICreateModal shows warning state when hasModelProviders is false" | DUPLICATE | Covered by AICreateModal.test.tsx:609-727 (warning, no textarea, no generate, no pills, no skip) |
| specs/scenarios/ai-create-modal.feature | "AICreateModal shows normal UI when hasModelProviders is true" | DUPLICATE | Covered by AICreateModal.test.tsx:730-808 (no warning, textarea, generate button, pills) |
| specs/scenarios/simulation-runner.feature | "Load scenario and prompt for execution" | KEEP | SimulationRunnerService.execute calls scenarioService.getById + uses PromptConfigAdapter; no unit test for this orchestration in simulation-runner.unit.test.ts (which is KSUID tests) |
| specs/scenarios/simulation-runner.feature | "Load scenario and HTTP agent for execution" | KEEP | resolveAdapter dispatches HttpAgentAdapter.create (simulation-runner.service.ts:198-202); no unit test covering full load+resolve flow |
| specs/scenarios/simulation-runner.feature | "Pass situation to SDK" | KEEP | scenario.situation passed as description (simulation-runner.service.ts:141); no test asserts SDK arg shape |
| specs/scenarios/simulation-runner.feature | "Pass criteria to SDK for judgment" | KEEP | scenario.criteria passed to judgeAgent (simulation-runner.service.ts:128-129); no test asserting criteria propagation |
| specs/scenarios/simulation-runner.feature | "Pass labels to SDK for tracing" | UPDATE | Labels are passed via OTEL_RESOURCE_ATTRIBUTES env (scenario.processor.otel-isolation.integration.test.ts:153), NOT as SDK metadata; spec wording outdated |
| specs/scenarios/simulation-runner.feature | "HTTP adapter sends request to endpoint" | DUPLICATE | Covered by adapters/__tests__/http-agent.adapter.test.ts:101-214 (bearer/api_key/basic/none auth + endpoint) |
| specs/scenarios/simulation-runner.feature | "Prompt adapter uses prompt configuration" | DUPLICATE | Covered by adapters/__tests__/prompt-config.adapter.test.ts:51-176 (system prompt, messages, temperature, maxTokens) |
| specs/scenarios/simulation-runner.feature | "Emit run started event" | DUPLICATE | RUN_STARTED emission tested via extensible-metadata.integration.test.ts:87-96 + scenario-event.service.integration.test.ts |
| specs/scenarios/simulation-runner.feature | "Emit message events during conversation" | DUPLICATE | MESSAGE_SNAPSHOT emission/consumption covered by scenario-event.service.integration.test.ts:95-160 |
| specs/scenarios/simulation-runner.feature | "Emit run finished event with results" | KEEP | RUN_FINISHED enum exists; no test directly asserts event shape on completion (only stall-detection consumes it) |
| specs/scenarios/simulation-runner.feature | "Execute scenario in isolated child process via execution reactor" | DUPLICATE | Covered by scenario.processor.spawning.integration.test.ts:33-63 (spawns child, receives serialized data) |
| specs/scenarios/simulation-runner.feature | "Child process has isolated OTEL context" | DUPLICATE | Covered by scenario.processor.otel-isolation.integration.test.ts:35-72 (sends to LANGWATCH_ENDPOINT, OTEL traces endpoint) |
| specs/scenarios/simulation-runner.feature | "Child traces include scenario metadata" | DUPLICATE | Covered by scenario.processor.otel-isolation.integration.test.ts:74-150 (concurrent processes, distinct scenarioId, batchRunId) |
| specs/scenarios/simulation-runner.feature | "Child events include scenario set ID" | DUPLICATE | Covered by scenario.processor.otel-isolation.integration.test.ts:178-210 "includes setId in scenario events sent to collector" |
| specs/scenarios/simulation-runner.feature | "OTEL context is cleaned up after child execution" | DUPLICATE | Covered by scenario.processor.cleanup.integration.test.ts:34-66 (exit code, flushes traces before termination) |
| specs/scenarios/simulation-runner.feature | "Execution pool reports success to failure handler" | DUPLICATE | Covered by scenario.processor.results.integration.test.ts:33-48 + execution-pool.unit.test.ts |
| specs/scenarios/simulation-runner.feature | "Execution pool reports errors to failure handler" | DUPLICATE | Covered by scenario.processor.results.integration.test.ts:50-73 + scenario-processor-failure-handler.unit.test.ts |
| specs/scenarios/simulation-runner.feature | "Return immediate error when project default model not configured" | DUPLICATE | Covered by api/routers/scenarios/__tests__/simulation-runner.router.unit.test.ts:101-126 |
| specs/scenarios/simulation-runner.feature | "Return immediate error when prompt has no model configured" | KEEP | Router test covers prompt-not-found, but not "prompt exists without a model"; spec describes a distinct case |
| specs/scenarios/simulation-runner.feature | "Return immediate error when scenario not found" | DUPLICATE | Covered by simulation-runner.router.unit.test.ts:128-164 (BAD_REQUEST + not-scheduled + not-found message) |
| specs/scenarios/simulation-runner.feature | "Return immediate error when prompt not found" | DUPLICATE | Covered by simulation-runner.router.unit.test.ts:166-200 (prompt target, BAD_REQUEST, not-scheduled, not found) |
| specs/scenarios/simulation-runner.feature | "Return error when scenario not found" | DUPLICATE | Covered at orchestrator level: orchestrator.unit.test.ts:106-121 (returns failure with "Scenario...not found") |
| specs/scenarios/simulation-runner.feature | "Return error when prompt not found" | DUPLICATE | Covered by orchestrator.unit.test.ts:180-196 (adapter creation fails with "Prompt not found") |
| specs/scenarios/simulation-runner.feature | "Return error when HTTP agent not found" | KEEP | http-agent.adapter.test.ts:67-81 covers adapter-throws case; no orchestrator/worker-level test propagating "HTTP agent ... not found" |
| specs/scenarios/simulation-runner.feature | "Return error when model provider disabled" | UPDATE | Covered partially by orchestrator.unit.test.ts:158-178 (provider_not_found yields "model provider was not found"); spec error message "not configured or disabled" diverges from actual text |
| specs/scenarios/scenario-deletion.feature | "Archive a single scenario via row action menu" | KEEP | E2E — backend/UI primitives implemented (ScenarioArchiveDialog, ScenarioTable, batchArchive); no E2E test exists yet |
| specs/scenarios/scenario-deletion.feature | "Batch archive multiple selected scenarios" | KEEP | E2E — pieces exist (BatchActionBar, batchArchive mutation) but no full E2E flow test |
| specs/scenarios/scenario-deletion.feature | "Select all checkbox toggles all visible rows" | DUPLICATE | Covered by ScenarioTable.integration.test.tsx "when select all checkbox is clicked" describe block |
| specs/scenarios/scenario-deletion.feature | "Select all with active filter only selects visible rows" | DUPLICATE | Covered by ScenarioTable.integration.test.tsx "when a label filter is active" describe block |
| specs/scenarios/scenario-deletion.feature | "Deselecting all rows hides the batch action bar" | DUPLICATE | Covered by ScenarioTable.integration.test.tsx BatchActionBar "when selection transitions from 1 to 0" |
| specs/scenarios/scenario-deletion.feature | "Row action menu contains archive option" | DUPLICATE | Covered by ScenarioTable.integration.test.tsx "when row action menu is opened" / "contains an Archive option" |
| specs/scenarios/scenario-deletion.feature | "Single archive confirmation modal shows scenario name" | DUPLICATE | Covered by ScenarioTable.integration.test.tsx ScenarioArchiveDialog "when archiving a single scenario" |
| specs/scenarios/scenario-deletion.feature | "Cancel single archive dismisses modal without archiving" | DUPLICATE | Covered by ScenarioTable.integration.test.tsx "calls onClose when Cancel is clicked" / "does not call onConfirm" |
| specs/scenarios/scenario-deletion.feature | "Batch archive confirmation modal lists all selected scenarios" | DUPLICATE | Covered by ScenarioTable.integration.test.tsx ScenarioArchiveDialog "when archiving multiple scenarios" |
| specs/scenarios/scenario-deletion.feature | "Cancel batch archive dismisses modal and preserves selection" | DUPLICATE | Covered by ScenarioTable.integration.test.tsx "calls onClose when Cancel is clicked without calling onConfirm" |
| specs/scenarios/scenario-deletion.feature | "Archived scenario is soft-deleted, not permanently removed" | DUPLICATE | Covered by scenario-archive.integration.test.ts archive() "preserves the scenario record in the database" |
| specs/scenarios/scenario-deletion.feature | "Archived scenario does not appear in the scenario list" | DUPLICATE | Covered by scenario-archive.integration.test.ts archive() "does not appear in list queries" |
| specs/scenarios/scenario-deletion.feature | "Archived scenario is still accessible for historical lookups" | DUPLICATE | Covered by scenario-archive.integration.test.ts archive() "is still found by findByIdIncludingArchived" |
| specs/scenarios/scenario-deletion.feature | "Batch archive marks all selected scenarios as archived" | DUPLICATE | Covered by scenario-archive.integration.test.ts batchArchive() "sets archivedAt on all selected scenarios" |
| specs/scenarios/scenario-deletion.feature | "Batch archive reports individual failures" | DUPLICATE | Covered by scenario-archive.integration.test.ts batchArchive() "reports individual failures while archiving valid ones" |
| specs/scenarios/scenario-deletion.feature | "Run again is blocked for archived scenarios" | DUPLICATE | Covered by ScenarioRunActions.integration.test.tsx "given an archived scenario" / "displays a message" |
| specs/scenarios/scenario-deletion.feature | "Archived scenarios do not count against license limits" | DUPLICATE | Covered by scenario-archive.integration.test.ts license-limit "excludes archived scenarios from license count" |
| specs/scenarios/scenario-deletion.feature | "Archiving an already-archived scenario is idempotent" | DUPLICATE | Covered by scenario-archive.integration.test.ts archive() negative-paths "succeeds without error (idempotent)" |
| specs/scenarios/scenario-deletion.feature | "Cannot archive a scenario from a different project" | DUPLICATE | Covered by scenario-archive.integration.test.ts "when archiving a scenario from a different project" |
| specs/scenarios/scenario-deletion.feature | "Archiving a non-existent scenario returns not found" | DUPLICATE | Covered by scenario-archive.integration.test.ts "when archiving a non-existent scenario" |
| specs/scenarios/scenario-deletion.feature | "Toggling selection adds a scenario" | DUPLICATE | Covered by useScenarioSelection.integration.test.ts toggle() "given no scenarios are selected" |
| specs/scenarios/scenario-deletion.feature | "Toggling selection removes an already-selected scenario" | DUPLICATE | Covered by useScenarioSelection.integration.test.ts toggle() "given a scenario is already selected" |
| specs/scenarios/scenario-deletion.feature | "Select all selects all visible scenarios" | DUPLICATE | Covered by useScenarioSelection.integration.test.ts selectAll() "adds all visible IDs to the selected set" |
| specs/scenarios/scenario-deletion.feature | "Deselect all clears the selection" | DUPLICATE | Covered by useScenarioSelection.integration.test.ts deselectAll() "clears the selected set" |
| specs/scenarios/scenario-deletion.feature | "Selection count reflects number of selected scenarios" | DUPLICATE | Covered by useScenarioSelection.integration.test.ts selectionCount "when 2 scenarios are selected returns 2" |
| specs/scenarios/scenario-failure-handler.feature | "Emit both RUN_STARTED and RUN_FINISHED when no events exist" | UPDATE | Implementation only dispatches finishRun (idempotent); RUN_STARTED never re-emitted. Scenario describes outdated design |
| specs/scenarios/scenario-failure-handler.feature | "Use pre-assigned scenarioRunId when no events exist in Elasticsearch" | UPDATE | Handler now requires pre-assigned scenarioRunId (returns early if missing); scenario premise about "no events exist" is outdated |
| specs/scenarios/scenario-failure-handler.feature | "Emit only RUN_FINISHED when RUN_STARTED exists" | UPDATE | Handler always emits only finishRun unconditionally; the conditional logic this scenario describes no longer exists |
| specs/scenarios/scenario-failure-handler.feature | "Idempotent - no action when RUN_FINISHED already exists" | DELETE | Handler always dispatches finishRun; idempotency now lives downstream in event-sourcing aggregate, not in the handler itself |
| specs/scenarios/scenario-failure-handler.feature | "Generate synthetic scenarioRunId with correct format" | DELETE | Handler no longer generates synthetic IDs (returns early if scenarioRunId missing); IDs use KSUID not nanoid (scenario.ids.ts:16) |
| specs/scenarios/scenario-failure-handler.feature | "Include job metadata in failure events" | KEEP | Handler does include projectId/scenarioId/setId/batchRunId via finishRun call but no test asserts all metadata fields |
| specs/scenarios/scenario-failure-handler.feature | "Worker calls failure handler on job failure" | DUPLICATE | Covered by scenario-processor-failure-handler.unit.test.ts "calls ensureFailureEventsEmitted with correct parameters" |
| specs/scenarios/scenario-failure-handler.feature | "Worker does not call failure handler on success" | KEEP | Documented contract in scenario-processor-failure-handler.unit.test.ts but not actually asserted; worker integration test missing |
| specs/scenarios/scenario-failure-handler.feature | "Failure handler errors do not crash worker" | KEEP | Documented contract only (placeholder test asserts true); needs real integration test of the worker.on("completed") try/catch |
| specs/scenarios/scenario-failure-handler.feature | "Return success when RUN_STARTED exists with IN_PROGRESS status" | DUPLICATE | Covered by pollForScenarioRun.unit.test.ts "returns success when RUN_STARTED exists with IN_PROGRESS status" |
| specs/scenarios/scenario-failure-handler.feature | "Return error when run has ERROR status" | DUPLICATE | Covered by pollForScenarioRun.unit.test.ts "returns error when run has ERROR status" |
| specs/scenarios/scenario-failure-handler.feature | "Return error when run has FAILED status" | DUPLICATE | Covered by pollForScenarioRun.unit.test.ts "returns error when run has FAILED status" |
| specs/scenarios/scenario-failure-handler.feature | "Continue polling when no runs exist yet" | DUPLICATE | Covered by pollForScenarioRun.unit.test.ts "continues polling when no runs exist yet and times out" |
| specs/scenarios/scenario-failure-handler.feature | "Frontend displays error instead of timeout on job failure" | KEEP | E2E — backend dispatches finishRun with ERROR status but no E2E test asserts UI navigation + error message rendering |
| specs/scenarios/scenario-failure-handler.feature | "Frontend displays error when child process crashes" | KEEP | E2E — child process crash error path implemented (scenario.processor.ts:390) but no E2E asserting UI shows error + ERROR status |
| specs/scenarios/scenario-failure-handler.feature | "Run history shows failed runs with error details" | KEEP | E2E — failed runs persist via finishRun but no E2E test exercising run history UI for failed runs |
| specs/scenarios/scenario-failure-handler.feature | "Timed-out child process triggers failure handler" | UPDATE | Timeout is 15 minutes, not 5 minutes (scenario.constants.ts:38: 15 \| 60 \| 1000); scenario states "5 minutes" — outdated |
| specs/scenarios/scenario-failure-handler.feature | "Scenario processor logs timeout with error level" | UPDATE | Timeout is 15 minutes, not 5 minutes; logging exists at scenario.processor.ts:354 but scenario premise outdated |
| specs/scenarios/internal-set-namespace.feature | "Detect internal set ID by prefix" | DUPLICATE | Covered by internal-set-id.unit.test.ts isInternalSetId() prefix-detection tests \| existing impl |
| specs/scenarios/internal-set-namespace.feature | "Reject non-internal set ID" | DUPLICATE | Covered by internal-set-id.unit.test.ts isInternalSetId() returns-false suite |
| specs/scenarios/internal-set-namespace.feature | "Detect on-platform set by suffix" | DUPLICATE | Covered by internal-set-id.unit.test.ts isOnPlatformSet() with on-platform suffix |
| specs/scenarios/internal-set-namespace.feature | "Reject set without on-platform suffix" | DUPLICATE | Covered by internal-set-id.unit.test.ts "internal set without on-platform suffix" returns false |
| specs/scenarios/internal-set-namespace.feature | "Reject user-created set ending in on-platform suffix" | DUPLICATE | Covered by internal-set-id.unit.test.ts "user-set__on-platform-scenarios" returns false |
| specs/scenarios/internal-set-namespace.feature | "Generate on-platform set ID for project" | DUPLICATE | Covered by internal-set-id.unit.test.ts getOnPlatformSetId() exact-format test |
| specs/scenarios/internal-set-namespace.feature | "On-platform scenario run uses internal set ID" | DUPLICATE | Covered by simulation-runner.router.unit.test.ts "called without explicit setId" + getOnPlatformSetId |
| specs/scenarios/internal-set-namespace.feature | "External SDK run preserves user-provided set ID" | DUPLICATE | Covered by simulation-runner.router.unit.test.ts "called with explicit setId" preserves "production-tests" |
| specs/scenarios/internal-set-namespace.feature | "Display friendly name for internal set" | UPDATE | Impl uses ON_PLATFORM_DISPLAY_NAME="Manual Run" not "On-Platform Scenarios"; SetCard.test.tsx skips this assertion |
| specs/scenarios/internal-set-namespace.feature | "Display system icon for internal set" | DUPLICATE | Covered by SetCard.test.tsx "displays a system/settings icon instead of the default icon" |
| specs/scenarios/internal-set-namespace.feature | "Display user set name for non-internal set" | DUPLICATE | Covered by SetCard.test.tsx "displays the set ID as the name" + "displays the default icon" |
| specs/scenarios/internal-set-namespace.feature | "Pin internal set to top of list" | DUPLICATE | Covered by simulations-page.test.tsx sortScenarioSets() "pins internal set" + sorts remaining by lastRunAt |
| specs/scenarios/internal-set-namespace.feature | "View on-platform scenarios in simulations list" | KEEP | E2E flow not covered; only unit/integration tests exist for SetCard, sort, router |
| specs/scenarios/stalled-scenario-runs.feature | "Run without RUN_FINISHED within threshold remains IN_PROGRESS" | DUPLICATE | Covered by stall-detection.unit.test.ts "within the threshold returns IN_PROGRESS" |
| specs/scenarios/stalled-scenario-runs.feature | "Run without RUN_FINISHED beyond threshold becomes STALLED" | DUPLICATE | Covered by stall-detection.unit.test.ts "beyond the threshold returns STALLED" (uses 35min) |
| specs/scenarios/stalled-scenario-runs.feature | "Run at exactly the threshold boundary becomes STALLED" | UPDATE | Spec says 10min; impl is 30min (CHILD_PROCESS.TIMEOUT_MS*2). Test exists but uses STALL_THRESHOLD_MS const |
| specs/scenarios/stalled-scenario-runs.feature | "Run with RUN_FINISHED keeps its original status regardless of age" | DUPLICATE | Covered by stall-detection.unit.test.ts "RUN_FINISHED... SUCCESS regardless of age" |
| specs/scenarios/stalled-scenario-runs.feature | "Failed run with RUN_FINISHED is not marked as STALLED" | DUPLICATE | Covered by stall-detection.unit.test.ts "RUN_FINISHED... ERROR regardless of age" |
| specs/scenarios/stalled-scenario-runs.feature | "Stall detection uses the last event timestamp, not just RUN_STARTED" | DUPLICATE | Covered by stall-detection.unit.test.ts "MESSAGE_SNAPSHOT... returns IN_PROGRESS" |
| specs/scenarios/stalled-scenario-runs.feature | "Batch query marks individual stalled runs within a batch" | DUPLICATE | Covered by stall-detection-batch.unit.test.ts "marks run A SUCCESS, B STALLED, C IN_PROGRESS" |
| specs/scenarios/stalled-scenario-runs.feature | "Stalled run displays with warning visual in status icon" | DUPLICATE | Covered by SCENARIO_RUN_STATUS_CONFIG[STALLED]={yellow,AlertTriangle} + scenario-run-status.utils.test |
| specs/scenarios/stalled-scenario-runs.feature | "Stalled run displays warning badge in previous runs list" | DUPLICATE | Covered by stalled-status-display.integration.test.ts getStatusBadgeProps yellow + label "stalled" |
| specs/scenarios/stalled-scenario-runs.feature | "Status display shows STALLED text in simulation console" | DUPLICATE | Covered by stalled-status-display.integration.test.ts STATUS_DISPLAY_TEXT_MAP[STALLED]="STALLED" |
| specs/scenarios/stalled-scenario-runs.feature | "Stalled run is treated as complete for overlay purposes" | DUPLICATE | Covered by stalled-status-display.integration.test.ts getOverlayConfig isComplete=true for STALLED |
| specs/scenarios/stalled-scenario-runs.feature | "User sees stalled indicator for a run that never completed" | KEEP | E2E user flow not covered; no e2e tests under langwatch/e2e for this surface |
| specs/scenarios/model-params-error-feedback.feature | "Reject model string without provider prefix" | KEEP | Factory createDataPrefetcherDependencies returns invalid_model_format but no direct unit test for the factory branch |
| specs/scenarios/model-params-error-feedback.feature | "Reject model when provider is not found in project" | KEEP | Factory returns provider_not_found in production code; no test exercises this exact reason code path |
| specs/scenarios/model-params-error-feedback.feature | "Reject model when provider exists but is not enabled" | DUPLICATE | data-prefetcher.unit.test.ts "model params preparation fails... provider_not_enabled" forwards this exact reason |
| specs/scenarios/model-params-error-feedback.feature | "Reject when resolved params are missing API key" | KEEP | Factory returns missing_params for missing creds; no unit test directly verifies this branch |
| specs/scenarios/model-params-error-feedback.feature | "Reject when resolved params are missing model" | KEEP | Factory returns missing_params for missing model; no unit test directly verifies this branch |
| specs/scenarios/model-params-error-feedback.feature | "Return preparation_error on unexpected exception" | KEEP | Factory catch-block returns preparation_error; no unit test exercises throw path |
| specs/scenarios/model-params-error-feedback.feature | "Return success with LiteLLM params on valid configuration" | KEEP | Factory returns success; only mocked-provider tests exist, no test against real factory branch |
| specs/scenarios/model-params-error-feedback.feature | "Prefetcher forwards reason code from model params failure" | DUPLICATE | data-prefetcher.unit.test.ts asserts result.reason==="provider_not_enabled" + error message forwarded |
| specs/scenarios/model-params-error-feedback.feature | "Prefetcher logs model params failure with reason" | KEEP | Logger call with reason exists in source but no test asserts logger received reason+model string |
| specs/scenarios/model-params-error-feedback.feature | "TRPC layer returns actionable error for invalid model format" | KEEP | Router rethrows BAD_REQUEST with prefetchResult.error but unit test mocks prefetcher; no integration test |
| specs/scenarios/model-params-error-feedback.feature | "TRPC layer returns actionable error for disabled provider" | KEEP | Router unit test mocks prefetcher generically; no test asserts reason-specific message reaches TRPC layer |
| specs/scenarios/model-params-error-feedback.feature | "TRPC layer returns actionable error for missing API key" | KEEP | Router unit test mocks prefetcher generically; no test for missing API key reason at TRPC boundary |
| specs/scenarios/scenario-execution.feature | "Run scenario with prompt target" | KEEP | E2E UI flow (Run button \| navigate \| see conversation); no e2e test exists in tests-e2e/ for scenarios |
| specs/scenarios/scenario-execution.feature | "Run scenario with HTTP agent target" | KEEP | E2E UI flow with HTTP agent target; no e2e test in repo, RunScenarioModalTargetSelector covers selection only |
| specs/scenarios/scenario-execution.feature | "View conversation in real-time" | KEEP | Run visualization page realtime streaming; no test for conversation rendering UI |
| specs/scenarios/scenario-execution.feature | "View completed run results" | KEEP | Run results page (pass/fail per criterion, conversation, reasoning); no UI test exists |
| specs/scenarios/scenario-execution.feature | "Navigate back to scenarios after viewing results" | KEEP | UI navigation; no "Back to Scenarios" test found in components/scenarios or simulations |
| specs/scenarios/scenario-execution.feature | "View run history for a scenario" | KEEP | History list UI; PreviousRunsList exists but no integration test verifies "view run history for scenario X" |
| specs/scenarios/scenario-execution.feature | "Run Again preserves scenario set" | KEEP | UI behavior; simulation-runner.router covers explicit setId backend, no UI test for Run Again button |
| specs/scenarios/scenario-execution.feature | "Run Again with remembered target" | KEEP | UI target-preference persistence not implemented; no rememberTarget/targetPreference code found |
| specs/scenarios/scenario-execution.feature | "Run Again without remembered target" | KEEP | UI prompt-for-target flow on Run Again; no UI test exists |
| specs/scenarios/scenario-execution.feature | "Error toast when running scenario without model provider configured" | KEEP | UI toast layer; backend covered (simulation-runner.router.unit "no default model"), no UI toast test |
| specs/scenarios/scenario-execution.feature | "Navigate to settings from error toast" | KEEP | UI toast link to settings; no test, requires toast component + router assertion |
| specs/scenarios/event-driven-execution-prep.feature | "QUEUED runs can be cancelled" | DUPLICATE | cancellation-eligibility.unit.test.ts:53 "when status is QUEUED returns true" |
| specs/scenarios/event-driven-execution-prep.feature | "Terminal statuses remain non-cancellable" | DUPLICATE | cancellation-eligibility.unit.test.ts covers SUCCESS/FAILED/ERROR/CANCELLED returning false |
| specs/scenarios/event-driven-execution-prep.feature | "Ad-hoc run dispatches queueRun command" | DUPLICATE | simulation-runner.router.unit.test.ts:335 "dispatches queueRun command before scheduling" |
| specs/scenarios/event-driven-execution-prep.feature | "Suite run dispatches queueRun for each scenario" | KEEP | Suite runner queueRun fan-out (3x2=6); no test for suite-level queueRun fan-out, only ad-hoc covered |
| specs/scenarios/event-driven-execution-prep.feature | "Execution reactor fires on queued event" | KEEP | scenarioExecution.reactor.ts exists but no test file in reactors/__tests__ exercises submit-on-queued |
| specs/scenarios/event-driven-execution-prep.feature | "Execution reactor skips already-cancelled runs" | KEEP | Logic in scenarioExecution.reactor.ts:71 (CancellationRequestedAt check); no test exists |
| specs/scenarios/event-driven-execution-prep.feature | "Pool starts child process when capacity is available" | DUPLICATE | execution-pool.unit.test.ts "when pool has capacity \| starts the job immediately" |
| specs/scenarios/event-driven-execution-prep.feature | "Pool buffers jobs when at capacity" | DUPLICATE | execution-pool.unit.test.ts "when pool is at capacity \| buffers the job" |
| specs/scenarios/event-driven-execution-prep.feature | "Pool dequeues pending jobs when a slot opens" | DUPLICATE | execution-pool.unit.test.ts "when pool is at capacity \| dequeues when a slot opens" |
| specs/scenarios/event-driven-execution-prep.feature | "GroupQueue distributes queued events across workers" | KEEP | Multi-worker distribution; no integration test for 6-pod x 18-event distribution |
| specs/scenarios/event-driven-execution-prep.feature | "Each worker respects its local concurrency limit" | DUPLICATE | execution-pool.unit.test.ts buffer/capacity tests cover per-worker concurrency=2 (parameterized analog) |
| specs/scenarios/scenario-editor.feature | "Navigate to create form" | KEEP | Page-routing scenario; ScenarioFormDrawer test covers drawer-open mode but not list-page navigation |
| specs/scenarios/scenario-editor.feature | "View scenario form fields" | KEEP | Static form-field visibility audit; no test asserts the four-field schema (Name/Situation/Criteria/Labels) |
| specs/scenarios/scenario-editor.feature | "Save new scenario" | DUPLICATE | ScenarioFormDrawer.integration.test.tsx "when user saves the form without running \| closes drawer after successful create" |
| specs/scenarios/scenario-editor.feature | "Load existing scenario for editing" | DUPLICATE | ScenarioFormDrawer.integration.test.tsx "when opened with a scenarioId (edit mode) \| displays Edit Scenario heading" |
| specs/scenarios/scenario-editor.feature | "Update scenario name" | DUPLICATE | ScenarioFormDrawer.integration.test.tsx "when user saves without running \| closes drawer after successful update" |
| specs/scenarios/scenario-editor.feature | "Add criterion to list" | DUPLICATE | CriteriaInput.test.tsx "when clicking add and saving \| saves criterion on Save click" |
| specs/scenarios/scenario-editor.feature | "Remove criterion from list" | DUPLICATE | CriteriaInput.test.tsx "when criteria exist \| removes criterion via trash button in edit mode" |
| specs/scenarios/scenario-editor.feature | "Criteria list validates empty input" | KEEP | CriteriaInput trims+ignores empty (handleSaveNew), but no test asserts empty rejection + validation message UI |
| specs/scenarios/scenario-editor.feature | "Configure prompt as target" | DUPLICATE | RunScenarioModalTargetSelector.integration.test.tsx covers TargetSelector prompt selection in modal |
| specs/scenarios/scenario-editor.feature | "Configure HTTP agent as target" | DUPLICATE | ScenarioFormDrawer.integration.test.tsx "when clicking Add New Agent \| auto-selects the saved agent as target" |
| specs/scenarios/scenario-api.feature | "Create scenario with valid data" | DUPLICATE | scenario.integration.test.ts:53 "when creating a scenario \| creates a scenario" with projectId |
| specs/scenarios/scenario-api.feature | "Create scenario validates required fields" | UPDATE | Validation lives in Zod schema (createScenarioSchema); HTTP POST test is skipped, rewrite as router-level Zod validation test |
| specs/scenarios/scenario-api.feature | "List scenarios for project" | DUPLICATE | scenario.integration.test.ts:68 "gets all scenarios for project" |
| specs/scenarios/scenario-api.feature | "Get scenario by ID" | DUPLICATE | scenario.integration.test.ts:83 "gets scenario by id" |
| specs/scenarios/scenario-api.feature | "Scenarios are project-scoped" | DUPLICATE | scenario.integration.test.ts:183 "isolates scenarios by project" |
| specs/scenarios/scenario-api.feature | "Update scenario fields" | DUPLICATE | scenario.integration.test.ts:104 "updates a scenario" covers name+criteria replacement |
| specs/scenarios/scenario-api.feature | "Update preserves unmodified fields" | KEEP | Partial-update merge semantics; not asserted (test updates all fields, doesn't assert situation preserved when only name changed) |
| specs/scenarios/scenario-api.feature | "Delete scenario" | DUPLICATE | scenarios-api.integration.test.ts:344 "archives the scenario and returns success" + 354 list excludes archived |
| specs/scenarios/scenario-api.feature | "Run scenario against prompt target" | UPDATE | Backend now uses event-sourcing (queueRun + fold), not "events emitted to ES scenario-events"; rewrite per simulation-runner.router behavior |
| specs/scenarios/scenario-api.feature | "Get run state returns conversation events" | KEEP | scenarios.getRunState exists in scenario-events.router.ts:190 but no test asserts state+events shape |
| specs/scenarios/scenario-editor-new-agent-flow.feature | "Clicking Add New Agent in save-and-run menu opens agent type selection" | KEEP | SaveAndRunMenu has Add New Agent; ScenarioFormDrawer opens AgentTypeSelectorDrawer. No integration test for menu->drawer. |
| specs/scenarios/scenario-editor-new-agent-flow.feature | "Agent type selector drawer remains open after clicking Add New Agent" | DUPLICATE | ScenarioFormDrawer.integration.test.tsx asserts drawer renders + no URL openDrawer (regression #1903). |
| specs/scenarios/scenario-editor-new-agent-flow.feature | "Selecting code agent type from scenario editor opens code editor" | DUPLICATE | AgentTypeSelectorDrawer.test.tsx asserts code click->openDrawer agentCodeEditor. |
| specs/scenarios/scenario-editor-new-agent-flow.feature | "Selecting workflow agent type from scenario editor opens workflow selector" | DUPLICATE | AgentTypeSelectorDrawer.test.tsx asserts workflow click->openDrawer workflowSelector. |
| specs/scenarios/scenario-editor-new-agent-flow.feature | "Selecting HTTP agent type from scenario editor opens HTTP editor" | KEEP | AgentTypeSelectorDrawer code routes http->agentHttpEditor; existing test only covers code+workflow. |
| specs/scenarios/scenario-editor-new-agent-flow.feature | "New agent created from scenario editor is auto-selected as target" | DUPLICATE | ScenarioFormDrawer.integration.test.tsx covers onSave callback auto-selecting agent + toaster. |
| specs/scenarios/scenario-editor-new-agent-flow.feature | "Cancelling agent type selection returns to scenario editor" | KEEP | AgentTypeSelectorDrawer has Cancel button; no test for cancel-without-create flow. |
| specs/scenarios/internal-scenario-namespace.feature | "Simulation layout header shows friendly name for internal sets" | UPDATE | SimulationLayout uses ON_PLATFORM_DISPLAY_NAME="Manual Run" not "On-Platform Scenarios"; SimulationLayout.test has it.skip. |
| specs/scenarios/internal-scenario-namespace.feature | "Simulation layout header shows raw ID for user-created sets" | DUPLICATE | SimulationLayout.test.tsx already asserts user setId rendered raw. |
| specs/scenarios/internal-scenario-namespace.feature | "Empty state message shows friendly name for internal sets" | UPDATE | SetRunHistorySidebarComponent.test has it.skip pending display name change to "On-Platform Scenarios". |
| specs/scenarios/internal-scenario-namespace.feature | "Empty state message shows raw ID for user-created sets" | DUPLICATE | SetRunHistorySidebarComponent.test.tsx asserts user setId in empty state message. |
| specs/scenarios/internal-scenario-namespace.feature | "Legacy PLATFORM_SET_ID constant is removed" | DELETE | scenario.constants.ts no longer contains PLATFORM_SET_ID; aspirational cleanup is complete. |
| specs/scenarios/internal-scenario-namespace.feature | "All scenario set references use getOnPlatformSetId" | DELETE | Static-analysis lint scenario; aspirational cleanup verified by grep — done. |
| specs/scenarios/scenario-library.feature | "Navigate to scenarios list" | KEEP | ScenarioLibraryPage renders heading + New Scenario button; no integration test for the page wrapper. |
| specs/scenarios/scenario-library.feature | "View scenarios in list" | DUPLICATE | ScenarioTable.integration.test.tsx renders rows with names + label tag pills. |
| specs/scenarios/scenario-library.feature | "Click scenario row to edit" | KEEP | Index page uses onRowClick->openDrawer scenarioEditor; no row-click navigation test in ScenarioTable.test. |
| specs/scenarios/scenario-library.feature | "Empty state when no scenarios" | KEEP | ScenarioEmptyState renders when no scenarios + welcome dismissed; no test asserts CTA wiring. |
| specs/scenarios/scenario-library.feature | "Filter scenarios by label" | DUPLICATE | ScenarioTable.integration.test "label filter active" asserts only filtered rows visible. |
| specs/scenarios/scenario-deferred-persistence.feature | "Create with AI opens editor without adding to the list" | DUPLICATE | ScenarioCreateModal.test.tsx (it.skip) + ScenarioFormDrawer.integration.test asserts no create on open with initialFormData. |
| specs/scenarios/scenario-deferred-persistence.feature | "Create blank opens editor without adding to the list" | DUPLICATE | ScenarioFormDrawer.integration.test "does not call create mutation on open" covers blank/skip path. |
| specs/scenarios/scenario-deferred-persistence.feature | "Save persists a new scenario" | DUPLICATE | ScenarioFormDrawer.integration.test "closes drawer after successful create" exercises Save->createMutateAsync. |
| specs/scenarios/scenario-deferred-persistence.feature | "Editing after first save updates the existing scenario" | KEEP | Drawer transitions to edit mode via URL update — no test asserts second save calls update not create. |
| specs/scenarios/scenario-deferred-persistence.feature | "Closing the editor before saving abandons the draft" | DUPLICATE | ScenarioFormDrawer.integration.test "drawer closed without saving does not create a DB record". |
| specs/scenarios/scenario-bulk-actions.feature | "Floating bar appears when scenarios are selected" | DUPLICATE | ScenarioTable.integration.test BatchActionBar tests assert bar renders + count when selectedCount > 0. |
| specs/scenarios/scenario-bulk-actions.feature | "Floating bar disappears when selection is cleared" | DUPLICATE | ScenarioTable.integration.test "selection transitions from 1 to 0 hides the batch action bar". |
| specs/scenarios/scenario-bulk-actions.feature | "Floating bar updates count when selection changes" | DUPLICATE | ScenarioTable.integration.test "when selection count changes updates displayed count". |
| specs/scenarios/scenario-bulk-actions.feature | "Floating bar stays fixed during scroll" | KEEP | BatchActionBar uses position=fixed bottom=10; no scroll-stickiness assertion exists. |
| specs/scenarios/scenario-bulk-actions.feature | "Archive selected scenarios via floating bar" | KEEP | BatchActionBar onArchive wires to batchArchiveMutation in index page; no end-to-end archive flow test. |
| specs/scenarios/scenario-job-id-uniqueness.feature | "Scheduling same scenario against two different targets produces distinct job IDs" | DELETE | scheduleScenarioRun() removed; jobs now keyed by pre-generated scenarioRunId so collisions impossible by design. |
| specs/scenarios/scenario-job-id-uniqueness.feature | "Job ID includes target reference ID" | DELETE | New job ID formula tenantId:scenarioRunId:queue-run does not include target referenceId — premise obsolete. |
| specs/scenarios/scenario-job-id-uniqueness.feature | "Scheduling same scenario three times in one batch produces three distinct job IDs" | DELETE | Each run already gets a unique scenarioRunId via generate(KSUID); repeat-index concern obsolete. |
| specs/scenarios/scenario-job-id-uniqueness.feature | "Running scenario against two targets with repeat=2 produces four distinct jobs" | DELETE | Multi-target/repeat scheduling now covered by per-run scenarioRunId; old combinatorial concern is gone. |
| specs/scenarios/scenario-drawer-close-on-save.feature | "Drawer closes after saving a new scenario" | DUPLICATE | ScenarioFormDrawer.integration.test "closes drawer after successful create" covers exact flow. |
| specs/scenarios/scenario-drawer-close-on-save.feature | "Drawer closes after updating an existing scenario" | DUPLICATE | ScenarioFormDrawer.integration.test edit mode "closes drawer after successful update" covers it. |
| specs/scenarios/scenario-drawer-close-on-save.feature | "Drawer stays open when save fails" | DUPLICATE | ScenarioFormDrawer.integration.test "when save fails keeps drawer open" + error toast assertions. |
| specs/scenarios/scenario-drawer-close-on-save.feature | "Drawer stays open after save-and-run" | UPDATE | ScenarioFormDrawer.integration.test asserts save-and-run CLOSES drawer + navigates; behavior contradicts scenario. |
| specs/scenarios/scenario-event-repository-tracing.feature | "<method> emits an OTel span with correct attributes" | DUPLICATE | scenario-event-repository-tracing.unit.test.ts covers all 6 listed methods with span name/kind/attrs. |
