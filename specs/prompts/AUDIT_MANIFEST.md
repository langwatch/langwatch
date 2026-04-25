# Prompts domain — `@unimplemented` audit manifest

**Scope**: every `@unimplemented`-tagged scenario under `specs/prompts/` (250 occurrences across 14 files).
**Method**: each scenario classified by reading the surrounding feature file, source code under `langwatch/src/prompts`, `langwatch/src/server/prompt-config`, `langwatch/src/components/prompts`, `langwatch/src/hooks/prompts`, related routers/APIs, and existing tests.
**Phase**: 0 (audit only). Phase 1 soldiers will execute the actions implied by the `Class` column.
**Plan**: `~/workspace/orchard-codex/plans/unimpl-reduction-2026-04-25.md`
**Tracking issue**: https://github.com/langwatch/langwatch/issues/3458

## Class definitions

| Class | Meaning | Phase 1 action |
|-------|---------|----------------|
| KEEP | Scenario describes intended behavior that still maps to the codebase. No automated test bound yet. | Phase 3 — write a test |
| UPDATE | Behavior partially still exists but the scenario describes outdated copy, field names, or interaction. | Phase 1 — rewrite the scenario, then Phase 3 — bind a test |
| DELETE | Aspirational, stale, or never implemented. No code path exists or the spec is contradictory. | Phase 1 — remove from spec |
| DUPLICATE | Already covered by another scenario in this domain or by an existing test. | Phase 1 — remove + cross-link in commit message |

## Manifest

| File | Scenario | Class | Rationale |
|------|----------|-------|-----------|
| specs/prompts/template-logic-autocomplete.feature | "Typing {% opens the logic autocomplete popup" | DUPLICATE | covered by templateLogicAutocomplete.integration.test.tsx "opens the logic autocomplete popup when typing {%" |
| specs/prompts/template-logic-autocomplete.feature | "Typing { alone does not open logic popup" | DUPLICATE | covered by templateLogicAutocomplete.integration.test.tsx "does not open logic popup when typing single {" |
| specs/prompts/template-logic-autocomplete.feature | "Typing {% at start of empty textarea" | DUPLICATE | covered by templateLogicAutocomplete.integration.test.tsx "opens logic popup when {% is at start of empty textarea" |
| specs/prompts/template-logic-autocomplete.feature | "Popup shows all template logic constructs" | DUPLICATE | covered by templateLogicAutocomplete.integration.test.tsx "shows all template logic constructs"; constructs in templateLogicConstructs.ts |
| specs/prompts/template-logic-autocomplete.feature | "Each construct shows a description" | DUPLICATE | covered by templateLogicAutocomplete.integration.test.tsx "shows description text for each construct" |
| specs/prompts/template-logic-autocomplete.feature | "Popup footer contains a docs link" | DUPLICATE | covered by templateLogicAutocomplete.integration.test.tsx "shows a link to the Liquid template syntax documentation" |
| specs/prompts/template-logic-autocomplete.feature | "Typing after {% filters the constructs list" | DUPLICATE | covered by templateLogicAutocomplete.integration.test.tsx "filters constructs list when typing after {%" |
| specs/prompts/template-logic-autocomplete.feature | "Typing partial match filters correctly" | DUPLICATE | covered by templateLogicAutocomplete.integration.test.tsx "filters correctly with partial match" |
| specs/prompts/template-logic-autocomplete.feature | "Filter with no matches shows empty state" | DUPLICATE | covered by templateLogicAutocomplete.integration.test.tsx "shows empty state when no constructs match" |
| specs/prompts/template-logic-autocomplete.feature | "Filter is case-insensitive" | DUPLICATE | covered by templateLogicAutocomplete.integration.test.tsx "filters case-insensitively" |
| specs/prompts/template-logic-autocomplete.feature | "Selecting "if" inserts if/endif block" | UPDATE | code uses "{% if  %}{% endif %}" (two spaces) but tests assert stringContaining only; spec exact string check needs stronger assertion |
| specs/prompts/template-logic-autocomplete.feature | "Selecting "for" inserts for/endfor block" | UPDATE | tests use stringContaining; cursor-position assertion not in existing test, requires strengthened assertion |
| specs/prompts/template-logic-autocomplete.feature | "Selecting "assign" inserts assign tag" | UPDATE | existing test only verifies menu closes; missing cursor-position and exact-string assertions per spec |
| specs/prompts/template-logic-autocomplete.feature | "Selecting "unless" inserts unless/endunless block" | KEEP | unless construct exists in templateLogicConstructs.ts but no dedicated test; needs new test |
| specs/prompts/template-logic-autocomplete.feature | "Selecting "comment" inserts comment/endcomment block" | UPDATE | existing test only verifies menu closes; missing exact-string assertion per spec |
| specs/prompts/template-logic-autocomplete.feature | "Selecting "elsif" inserts inline elsif tag" | KEEP | elsif construct exists in templateLogicConstructs.ts but no dedicated test; needs new test |
| specs/prompts/template-logic-autocomplete.feature | "Selecting "else" inserts inline else tag" | UPDATE | existing test only verifies menu closes; missing exact-string assertion per spec |
| specs/prompts/template-logic-autocomplete.feature | "Typed filter text is replaced by selected construct" | DUPLICATE | covered by templateLogicAutocomplete.integration.test.tsx "replaces partial filter text with selected construct" |
| specs/prompts/template-logic-autocomplete.feature | ""Add logic" button appears next to "Add variable" button on hover" | DUPLICATE | covered by templateLogicAutocomplete.integration.test.tsx "shows 'Add logic' button on hover alongside 'Add variable'" |
| specs/prompts/template-logic-autocomplete.feature | "Clicking "Add logic" opens the logic autocomplete popup" | DUPLICATE | covered by templateLogicAutocomplete.integration.test.tsx "opens logic menu and inserts construct at cursor position via button" |
| specs/prompts/template-logic-autocomplete.feature | ""Add logic" inserts at end of textarea content" | DUPLICATE | covered by templateLogicAutocomplete.integration.test.tsx "opens logic menu and inserts construct at cursor position via button" |
| specs/prompts/template-logic-autocomplete.feature | ""Add logic" button hidden when textarea is disabled" | DUPLICATE | covered by templateLogicAutocomplete.integration.test.tsx "hides 'Add logic' button when textarea is disabled" |
| specs/prompts/template-logic-autocomplete.feature | "ArrowDown moves highlight to next construct" | UPDATE | existing ArrowDown test only verifies no crash; spec asserts highlight movement which test does not verify |
| specs/prompts/template-logic-autocomplete.feature | "ArrowUp moves highlight to previous construct" | UPDATE | existing ArrowUp test only verifies no crash; spec asserts highlight movement which test does not verify |
| specs/prompts/template-logic-autocomplete.feature | "ArrowUp at first item does not wrap" | KEEP | non-wrapping behavior implemented in TemplateLogicMenu (Math.max bound) but no test verifies wrap behavior |
| specs/prompts/template-logic-autocomplete.feature | "ArrowDown at last item does not wrap" | KEEP | non-wrapping behavior implemented in TemplateLogicMenu (Math.min bound) but no test verifies wrap behavior |
| specs/prompts/template-logic-autocomplete.feature | "Enter selects the highlighted construct" | DUPLICATE | covered by templateLogicAutocomplete.integration.test.tsx "closes popup and inserts construct on Enter" |
| specs/prompts/template-logic-autocomplete.feature | "Tab selects the highlighted construct" | DUPLICATE | covered by templateLogicAutocomplete.integration.test.tsx "closes popup and inserts construct on Tab" |
| specs/prompts/template-logic-autocomplete.feature | "Escape closes the popup without inserting" | DUPLICATE | covered by templateLogicAutocomplete.integration.test.tsx "closes popup without inserting on Escape" |
| specs/prompts/template-logic-autocomplete.feature | "Opening logic popup closes variable menu" | KEEP | mutex implemented but no test verifies switching from variable menu to logic popup direction |
| specs/prompts/template-logic-autocomplete.feature | "Opening variable menu closes logic popup" | KEEP | mutex implemented but no test verifies switching from logic popup to variable menu direction |
| specs/prompts/template-logic-autocomplete.feature | "Only one popup is visible at a time" | DUPLICATE | covered by templateLogicAutocomplete.integration.test.tsx "does not show variable menu when {% is typed" |
| specs/prompts/template-logic-autocomplete.feature | "Popup closes when clicking outside" | KEEP | click-outside handler exists in TemplateLogicMenu.tsx (handleClickOutside) but no test verifies it |
| specs/prompts/template-logic-autocomplete.feature | "Completing {% tag manually does not leave popup open" | DUPLICATE | covered by templateLogicAutocomplete.integration.test.tsx "closes popup when completed {% tag is typed" |
| specs/prompts/template-logic-autocomplete.feature | "Multiple {% insertions in same text" | DUPLICATE | covered by templateLogicAutocomplete.integration.test.tsx "opens popup for new {% after existing completed tags" |
| specs/prompts/liquid-template-support.feature | "TypeScript SDK renders if/else conditions" | DUPLICATE | Covered by typescript-sdk/.../liquid-template-support.unit.test.ts "renders the matching branch" |
| specs/prompts/liquid-template-support.feature | "TypeScript SDK renders for loops over arrays" | DUPLICATE | Covered by typescript-sdk/.../liquid-template-support.unit.test.ts "renders each item with separator" |
| specs/prompts/liquid-template-support.feature | "TypeScript SDK renders assign tags" | DUPLICATE | Covered by typescript-sdk/.../liquid-template-support.unit.test.ts "renders assigned and input variables" |
| specs/prompts/liquid-template-support.feature | "TypeScript SDK renders filters" | DUPLICATE | Covered by typescript-sdk/.../liquid-template-support.unit.test.ts "applies upcase and truncate filters" |
| specs/prompts/liquid-template-support.feature | "TypeScript SDK renders nested conditions and loops" | DUPLICATE | Covered by typescript-sdk/.../liquid-template-support.unit.test.ts "renders only items matching the condition" |
| specs/prompts/liquid-template-support.feature | "TypeScript SDK compileStrict rejects undefined variables in Liquid tags" | DUPLICATE | Covered by typescript-sdk/.../liquid-template-support.unit.test.ts "throws a PromptCompilationError" |
| specs/prompts/liquid-template-support.feature | "TypeScript SDK compile tolerates undefined variables in Liquid tags" | DUPLICATE | Covered by typescript-sdk/.../liquid-template-support.unit.test.ts "tolerates them and renders remaining content" |
| specs/prompts/liquid-template-support.feature | "Python SDK renders if/else conditions" | DUPLICATE | Covered by python-sdk/tests/prompts/test_liquid_template_support.py TestWhenTemplateContainsIfElseConditions |
| specs/prompts/liquid-template-support.feature | "Python SDK renders for loops over arrays" | DUPLICATE | Covered by python-sdk/tests/prompts/test_liquid_template_support.py TestWhenTemplateContainsForLoops |
| specs/prompts/liquid-template-support.feature | "Python SDK renders assign tags" | DUPLICATE | Covered by python-sdk/tests/prompts/test_liquid_template_support.py TestWhenTemplateContainsAssignTags |
| specs/prompts/liquid-template-support.feature | "Python SDK renders filters" | DUPLICATE | Covered by python-sdk/tests/prompts/test_liquid_template_support.py test_renders_upcase_and_truncate_filters |
| specs/prompts/liquid-template-support.feature | "Python SDK compileStrict rejects undefined variables in Liquid tags" | DUPLICATE | Covered by python-sdk/tests/prompts/test_liquid_template_support.py test_raises_prompt_compilation_error |
| specs/prompts/liquid-template-support.feature | "Python SDK compile tolerates undefined variables in Liquid tags" | DUPLICATE | Covered by python-sdk/tests/prompts/test_liquid_template_support.py test_compile_tolerates_undefined_variables |
| specs/prompts/liquid-template-support.feature | "TypeScript and Python SDKs produce identical output for conditional templates" | KEEP | Both SDKs use Liquid; no cross-SDK golden-file parity test exists yet — valuable behavior |
| specs/prompts/liquid-template-support.feature | "TypeScript and Python SDKs produce identical output for loop templates" | KEEP | Both SDKs use Liquid; no cross-SDK golden-file parity test exists yet — valuable behavior |
| specs/prompts/liquid-template-support.feature | "Prompt config adapter renders Liquid conditions in system prompt" | DUPLICATE | Covered by langwatch/src/server/scenarios/execution/serialized-adapters/__tests__/prompt-config.adapter.unit.test.ts "renders if/else based on input content" |
| specs/prompts/liquid-template-support.feature | "Prompt config adapter renders Liquid loops in messages" | DUPLICATE | Covered by langwatch/.../prompt-config.adapter.unit.test.ts "renders for loops in message content" |
| specs/prompts/liquid-template-support.feature | "HTTP agent adapter renders Liquid conditions in body template" | DUPLICATE | Covered by langwatch/.../http-agent.adapter.unit.test.ts "renders if/else based on input content" |
| specs/prompts/liquid-template-support.feature | "DSPy template adapter renders Liquid conditions in message templates" | DUPLICATE | Covered by langwatch_nlp/tests/studio/test_template_adapter.py test_renders_liquid_conditions_in_message_templates |
| specs/prompts/liquid-template-support.feature | "DSPy template adapter renders Liquid conditions with missing optional input" | DUPLICATE | Covered by langwatch_nlp/tests/studio/test_template_adapter.py test_renders_liquid_conditions_with_missing_optional_input |
| specs/prompts/liquid-template-support.feature | "Tokenizer identifies if/endif tags" | DUPLICATE | Covered by langwatch/src/components/prompt-textarea/__tests__/liquidTokenizer.unit.test.ts if/endif case |
| specs/prompts/liquid-template-support.feature | "Tokenizer identifies for/endfor tags and variable expressions" | DUPLICATE | Covered by liquidTokenizer.unit.test.ts "identifies for/endfor as liquid-tag and variable expressions as variable" |
| specs/prompts/liquid-template-support.feature | "Tokenizer identifies assign tags" | DUPLICATE | Covered by liquidTokenizer.unit.test.ts "identifies assign as liquid-tag" |
| specs/prompts/liquid-template-support.feature | "Tokenizer identifies filters in variable expressions" | DUPLICATE | Covered by liquidTokenizer.unit.test.ts filters case |
| specs/prompts/liquid-template-support.feature | "Tokenizer identifies elsif and else tags" | DUPLICATE | Covered by liquidTokenizer.unit.test.ts "identifies elsif and else as liquid-tag tokens" |
| specs/prompts/liquid-template-support.feature | "Tokenizer handles mixed content correctly" | DUPLICATE | Covered by liquidTokenizer.unit.test.ts "tokenizes plain text, liquid tags, and variables correctly" |
| specs/prompts/liquid-template-support.feature | "Tokenizer treats unclosed tags as plain text" | DUPLICATE | Covered by liquidTokenizer.unit.test.ts "treats unclosed tags as plain text" |
| specs/prompts/liquid-template-support.feature | "Variable extraction finds variables inside Liquid tags" | DUPLICATE | Covered by liquidVariableExtraction.unit.test.ts "finds variables in both tag conditions and variable expressions" |
| specs/prompts/liquid-template-support.feature | "Variable extraction ignores Liquid keywords" | DUPLICATE | Covered by liquidVariableExtraction.unit.test.ts "does not extract Liquid keywords as variables" |
| specs/prompts/liquid-template-support.feature | "Variable extraction handles filters without treating filter names as variables" | DUPLICATE | Covered by liquidVariableExtraction.unit.test.ts "extracts only the variable name, not filter names" |
| specs/prompts/liquid-template-support.feature | "Variable extraction handles assign without treating assigned name as input variable" | DUPLICATE | Covered by liquidVariableExtraction.unit.test.ts "recognizes assigned names as locally assigned" |
| specs/prompts/liquid-template-support.feature | "Variable extraction handles nested Liquid structures" | DUPLICATE | Covered by liquidVariableExtraction.unit.test.ts "extracts the collection as input variable and loop iterator as loop variable" |
| specs/prompts/prompt-selection-drawer.feature | "PromptListDrawer shows list of prompts" | DUPLICATE | Covered by PromptListDrawer.test.tsx "Prompt list display" suite. |
| specs/prompts/prompt-selection-drawer.feature | "PromptListDrawer empty state" | DUPLICATE | Covered by PromptListDrawer.test.tsx "Empty state" describe block. |
| specs/prompts/prompt-selection-drawer.feature | "Each prompt shows relevant info" | KEEP | PromptCard renders icon+version+model; no test asserts model-icon rendering specifically. |
| specs/prompts/prompt-selection-drawer.feature | "Prompts grouped by folder" | KEEP | groupBy folder logic and collapsible sections exist; no end-to-end multi-folder test. |
| specs/prompts/prompt-selection-drawer.feature | "Expand folder to see prompts" | KEEP | Collapsible folder expand exists; no explicit click-to-expand assertion in tests. |
| specs/prompts/prompt-selection-drawer.feature | "Folder display shows prompt count" | KEEP | "({prompts.length})" rendered at line 344; needs an assertion test. |
| specs/prompts/prompt-selection-drawer.feature | "Select prompt from list" | UPDATE | Drawer no longer auto-closes on select (callback owns closing) — see test "does not auto-close drawer after selection". |
| specs/prompts/prompt-selection-drawer.feature | "Select prompt from folder" | UPDATE | Same drift as above: folder selection callback no longer triggers auto-close in current impl. |
| specs/prompts/prompt-selection-drawer.feature | "Selection callback receives prompt data" | KEEP | onSelect payload includes id/name/version/versionId/inputs/outputs in PromptListDrawer.tsx. |
| specs/prompts/prompt-selection-drawer.feature | "New Prompt button opens editor drawer" | DUPLICATE | Covered by PromptListDrawer.test.tsx "opens promptEditor drawer by default". |
| specs/prompts/prompt-selection-drawer.feature | "Create new prompt and select it" | KEEP | Flow exists via openDrawer("promptEditor")+onSelect callback chain; multi-step end-to-end untested. |
| specs/prompts/prompt-selection-drawer.feature | "Cancel new prompt returns to list" | KEEP | canGoBack/goBack present in PromptEditorDrawer; no explicit test. |
| specs/prompts/prompt-selection-drawer.feature | "PromptEditorDrawer create mode shows empty form" | UPDATE | Title is "New Prompt" but Outputs are inside LLM-config popover, not a separate field per scenario table. |
| specs/prompts/prompt-selection-drawer.feature | "Save new prompt" | UPDATE | Save now opens ChangeHandleDialog asking for handle/scope before persisting; not a single Save click. |
| specs/prompts/prompt-selection-drawer.feature | "Validation prevents saving without name" | UPDATE | Validation lives in ChangeHandleDialog handle field, not on a "name" field of the editor itself. |
| specs/prompts/prompt-selection-drawer.feature | "PromptEditorDrawer edit mode shows existing config" | UPDATE | Title shows the prompt handle (e.g. "test-prompt"), not literal "Edit Prompt"; system prompt rendering exists. |
| specs/prompts/prompt-selection-drawer.feature | "Edit and save prompt creates new version" | KEEP | Update mutation creates new version via SaveVersionDialog flow; no end-to-end test. |
| specs/prompts/prompt-selection-drawer.feature | "Discard changes warning" | UPDATE | window.confirm fires on close-with-unsaved when no onLocalConfigChange; not a custom dialog with discard/continue buttons. |
| specs/prompts/prompt-selection-drawer.feature | "Back button returns to previous drawer" | KEEP | canGoBack/goBack rendered with data-testid="back-button" in editor; no test. |
| specs/prompts/prompt-selection-drawer.feature | "No back button when opened directly" | KEEP | canGoBack guards visibility; no test asserting absence on direct open. |
| specs/prompts/prompt-selection-drawer.feature | "Drawer stack maintains history" | KEEP | drawerStack module-level state in useDrawer.ts handles push/pop; no end-to-end stack test. |
| specs/prompts/prompt-selection-drawer.feature | "Search prompts by name" | DUPLICATE | Covered by PromptListDrawer.test.tsx "filters prompts by name". |
| specs/prompts/prompt-selection-drawer.feature | "Search shows no results message when no matches" | DUPLICATE | Covered by PromptListDrawer.test.tsx "shows no results message when search has no matches". |
| specs/prompts/prompt-selection-drawer.feature | "Filter prompts by model" | DELETE | @future @unimplemented; no model-filter UI exists and scenario is explicitly aspirational. |
| specs/prompts/prompt-selection-drawer.feature | "PromptEditorDrawer header displays model selector" | UPDATE | ModelSelectFieldMini in body header (sticky), not a top header bar; clicking opens config not "LLM configuration modal". |
| specs/prompts/prompt-selection-drawer.feature | "PromptEditorDrawer header displays version history button" | UPDATE | VersionHistoryButton lives in the footer (PromptEditorFooter), not the header — see "renders version history button in the footer when editing". |
| specs/prompts/prompt-selection-drawer.feature | "PromptEditorDrawer header displays Save button" | UPDATE | Save button is in the footer (variant="model-only"), not header; "renders exactly one save button (in footer, not header)". |
| specs/prompts/prompt-selection-drawer.feature | "No version history button in create mode" | DUPLICATE | Covered by PromptEditorDrawer.test.tsx "does not show version history button in create mode". |
| specs/prompts/prompt-selection-drawer.feature | "Close without save in evaluations context preserves local changes" | DUPLICATE | Covered by PromptEditorDrawer.test.tsx "does not show warning dialog when onLocalConfigChange is provided". |
| specs/prompts/prompt-selection-drawer.feature | "Close without save in standalone context warns user" | KEEP | window.confirm fires when hasUnsavedChanges and no onLocalConfigChange (PromptEditorDrawer:866); needs assertion test. |
| specs/prompts/open-existing-prompt-from-trace.feature | "SDK emits combined prompt handle and version attribute" | KEEP | Behavior implemented in typescript-sdk/src/client-sdk/services/prompts/tracing/prompt-tracing.decorator.ts; needs an SDK test |
| specs/prompts/open-existing-prompt-from-trace.feature | "SDK emits nothing when prompt has no handle" | KEEP | TS SDK guards `result.handle != null && result.version != null`; needs an SDK test asserting absence |
| specs/prompts/open-existing-prompt-from-trace.feature | "SDK captures variables from compile" | KEEP | TS SDK sets langwatch.prompt.variables in prompt-tracing.decorator.ts; needs an explicit test |
| specs/prompts/open-existing-prompt-from-trace.feature | "Button becomes a dropdown menu when trace has prompt reference" | DUPLICATE | Covered by SpanDetails.integration.test.tsx "renders a dropdown menu trigger button" |
| specs/prompts/open-existing-prompt-from-trace.feature | "Button stays as simple button when trace has no prompt reference" | DUPLICATE | Covered by SpanDetails.integration.test.tsx "renders a simple link button" |
| specs/prompts/open-existing-prompt-from-trace.feature | "Opens existing prompt at traced version with variables applied" | KEEP | useLoadSpanIntoPromptPlayground.ts implements; only smoke-level integration tests exist for this flow |
| specs/prompts/open-existing-prompt-from-trace.feature | "Creates missing variables on the prompt when they dont exist" | KEEP | mergeTracedVariablesIntoInputs in useLoadSpanIntoPromptPlayground.ts implements; needs dedicated test |
| specs/prompts/open-existing-prompt-from-trace.feature | "Trace references a prompt that no longer exists" | KEEP | tryOpenExistingPromptTab returns null + toast when not found; needs scenario test |
| specs/prompts/open-existing-prompt-from-trace.feature | "Trace references a version that no longer exists" | KEEP | tryOpenExistingPromptTab emits "Version not found" toast and falls back to latest; needs test |
| specs/prompts/open-existing-prompt-from-trace.feature | "Create new prompt from trace data" | KEEP | useLoadSpanIntoPromptPlayground "create-new" action branch implemented; needs explicit test |
| specs/prompts/open-existing-prompt-from-trace.feature | "Backend extracts prompt reference and variables from span attributes" | DUPLICATE | Covered by parsePromptReference.unit.test.ts "extracts variables from valid JSON wrapper" + handle:version case |
| specs/prompts/open-existing-prompt-from-trace.feature | "Backend returns null prompt reference when no prompt attributes exist" | DUPLICATE | Covered by parsePromptReference.unit.test.ts "returns nulls for empty attrs" |
| specs/prompts/open-existing-prompt-from-trace.feature | "Prompt reference found on immediate parent span" | DUPLICATE | Covered by findPromptReferenceInAncestors.unit.test.ts (parent span case) |
| specs/prompts/open-existing-prompt-from-trace.feature | "Prompt reference found on grandparent span" | DUPLICATE | Covered by findPromptReferenceInAncestors.unit.test.ts (grandparent / deep-prompt case) |
| specs/prompts/open-existing-prompt-from-trace.feature | "No prompt reference on any ancestor span" | DUPLICATE | Covered by findPromptReferenceInAncestors.unit.test.ts (no-ancestor case) |
| specs/prompts/open-existing-prompt-from-trace.feature | "Single span prompt ID is hoisted to trace-level metadata" | DUPLICATE | Covered by traceSummaryAttributes.unit.test.ts "hoists to langwatch.prompt_ids as JSON array" |
| specs/prompts/open-existing-prompt-from-trace.feature | "Multiple spans with different prompts are combined" | DUPLICATE | Covered by traceSummaryAttributes.unit.test.ts "combines all prompt IDs into langwatch.prompt_ids array" |
| specs/prompts/open-existing-prompt-from-trace.feature | "Duplicate prompt IDs across spans are deduplicated" | DUPLICATE | Covered by traceSummaryAttributes.unit.test.ts "deduplicates in langwatch.prompt_ids" |
| specs/prompts/open-existing-prompt-from-trace.feature | "Backend extracts old-format separate prompt attributes" | DUPLICATE | Covered by parsePromptReference.unit.test.ts "old separate format" describe block |
| specs/prompts/open-existing-prompt-from-trace.feature | "Opens existing prompt at tagged version with variables applied" | KEEP | useLoadSpanIntoPromptPlayground passes promptTag through to getByIdOrHandle; needs scenario test |
| specs/prompts/open-existing-prompt-from-trace.feature | "Auto-detects open-existing action for tagged prompt reference" | KEEP | hasPromptReference check in useLoadSpanIntoPromptPlayground includes promptTag; needs explicit test |
| specs/prompts/open-existing-prompt-from-trace.feature | "Tag-based open does not show version-not-found toast" | KEEP | `promptVersionNumber != null` guard in tryOpenExistingPromptTab skips check for tags; needs test |
| specs/prompts/open-existing-prompt-from-trace.feature | "Button dropdown shows tag reference in menu option" | DUPLICATE | Covered by SpanDetails.integration.test.tsx "when span has a tagged prompt reference in params" |
| specs/prompts/open-existing-prompt-from-trace.feature | "Trace references a tag that is not assigned to any version" | KEEP | tryOpenExistingPromptTab catch branch emits "Tag not resolved" toast; needs scenario test |
| specs/prompts/open-existing-prompt-from-trace.feature | "Trace references a tagged prompt that no longer exists" | KEEP | Same fall-through path as deleted prompt + tag; needs scenario test |
| specs/prompts/open-existing-prompt-from-trace.feature | "Backend extracts prompt tag from span attributes" | DUPLICATE | Covered by parsePromptReference.unit.test.ts "slug:tag shorthand" describe block (tag returned, version null) |
| specs/prompts/custom-labels-deploy-dialog.feature | "Built-in tags are always available" | UPDATE | Only "latest" is PROTECTED; production/staging are SEEDED_TAGS auto-created per org, not "built-in" markers. |
| specs/prompts/custom-labels-deploy-dialog.feature | "Creating a custom tag definition" | DUPLICATE | Covered by prompt-tag.service.unit.test.ts create() suite + prompt-tags.integration.test.ts. |
| specs/prompts/custom-labels-deploy-dialog.feature | "Rejects tag names starting with a number" | DUPLICATE | Covered by prompt-tag.service.unit.test.ts validateTagName "throws for names starting with a digit". |
| specs/prompts/custom-labels-deploy-dialog.feature | "Rejects uppercase tag names" | DUPLICATE | Covered by prompt-tag.service.unit.test.ts validateTagName "throws for uppercase names". |
| specs/prompts/custom-labels-deploy-dialog.feature | "Accepts a valid lowercase tag name" | DUPLICATE | Covered by prompt-tag.service.unit.test.ts validateTagName "does not throw for a lowercase slug". |
| specs/prompts/custom-labels-deploy-dialog.feature | "Custom tags cannot shadow built-in tags" | UPDATE | "production"/"staging" are not in PROTECTED_TAGS — only "latest" is; uniqueness comes from DB constraint, not protection. |
| specs/prompts/custom-labels-deploy-dialog.feature | "Custom tags cannot shadow the "latest" pseudo-tag" | DUPLICATE | Covered by prompt-tag.service.unit.test.ts "throws PromptTagValidationError mentioning protected for 'latest'". |
| specs/prompts/custom-labels-deploy-dialog.feature | "Deleting a custom tag cascades to assignments" | KEEP | Cascade is documented in repo; integration test exists for delete but not the assignment-cascade assertion. |
| specs/prompts/custom-labels-deploy-dialog.feature | "Assigning a custom tag to a version" | KEEP | api.prompts.assignTag mutation exists; no integration test asserting PromptVersionTag row shape. |
| specs/prompts/custom-labels-deploy-dialog.feature | "Reassigning a custom tag to a different version" | KEEP | assignTag overwrites; no specific reassignment test in prompt-tags.integration.test.ts. |
| specs/prompts/custom-labels-deploy-dialog.feature | "Fetching with a custom tag returns the tagged version" | KEEP | getByTag flow exists in tags integration; no assertion specifically for custom tag vs built-in. |
| specs/prompts/custom-labels-deploy-dialog.feature | "Rejecting assignment of an undefined custom tag" | KEEP | assignTag validates tag exists for org; no negative-path test for unknown name. |
| specs/prompts/custom-labels-deploy-dialog.feature | "Listing tags for a prompt config includes custom tags" | KEEP | getTagsForConfig query exists; needs integration assertion mixing built-in + custom. |
| specs/prompts/custom-labels-deploy-dialog.feature | "Deploy dialog renders built-in and custom tag rows" | DUPLICATE | Covered by DeployPromptDialog.integration.test.tsx "renders rows for latest, production, staging, and the custom tag". |
| specs/prompts/custom-labels-deploy-dialog.feature | "Only "latest" has no delete button" | DUPLICATE | Covered by DeployPromptDialog.integration.test.tsx "does not render a delete button for the latest row" + production/staging variants. |
| specs/prompts/custom-labels-deploy-dialog.feature | "Deploy dialog shows empty state when no custom tags exist" | DUPLICATE | Covered by DeployPromptDialog.integration.test.tsx "shows only built-in rows and the '+ Add tag' button". |
| specs/prompts/custom-labels-deploy-dialog.feature | "Deploy dialog adds a custom tag row when user confirms input" | DUPLICATE | Covered by DeployPromptDialog.integration.test.tsx "adds a new custom tag row when user types and confirms". |
| specs/prompts/custom-labels-deploy-dialog.feature | "Deploy dialog rejects duplicate custom tag name" | DUPLICATE | Covered by DeployPromptDialog.integration.test.tsx "shows an error when trying to add an existing tag name". |
| specs/prompts/custom-labels-deploy-dialog.feature | "Deploy dialog removes custom tag row after delete confirmation" | DUPLICATE | Covered by DeployPromptDialog.integration.test.tsx "removes the custom tag row when user confirms deletion". |
| specs/prompts/custom-labels-deploy-dialog.feature | "Custom tag delete button is visible only for non-latest tags" | DUPLICATE | Covered by DeployPromptDialog.integration.test.tsx "renders a delete button for the custom tag row" + latest negative. |
| specs/prompts/structured-outputs-streaming.feature | "Default "output" identifier displays string value as-is" | DUPLICATE | Covered by output-formatter.test.ts "displays string value as-is". |
| specs/prompts/structured-outputs-streaming.feature | "Default "output" identifier displays float value as-is" | DUPLICATE | Covered by output-formatter.test.ts "displays float value as string". |
| specs/prompts/structured-outputs-streaming.feature | "Default "output" identifier displays bool value as-is" | DUPLICATE | Covered by output-formatter.test.ts "displays boolean value as string". |
| specs/prompts/structured-outputs-streaming.feature | "Default "output" identifier displays json_schema as formatted JSON" | DUPLICATE | Covered by output-formatter.test.ts "displays json_schema as formatted JSON". |
| specs/prompts/structured-outputs-streaming.feature | "Custom identifier wraps string value in JSON object" | DUPLICATE | Covered by output-formatter.test.ts "wraps string value in JSON object". |
| specs/prompts/structured-outputs-streaming.feature | "Custom identifier wraps float value in JSON object" | DUPLICATE | Covered by output-formatter.test.ts "wraps float value in JSON object". |
| specs/prompts/structured-outputs-streaming.feature | "Custom identifier wraps boolean value in JSON object" | DUPLICATE | Covered by output-formatter.test.ts "wraps boolean true value in JSON object" + false variant. |
| specs/prompts/structured-outputs-streaming.feature | "Custom identifier wraps json_schema value in JSON object" | DUPLICATE | Covered by output-formatter.test.ts "wraps json_schema value in JSON object with nested structure". |
| specs/prompts/structured-outputs-streaming.feature | "Empty outputs configuration" | DUPLICATE | Covered by output-formatter.test.ts edge-cases "when configs is empty array" and "when configs is undefined". |
| specs/prompts/structured-outputs-streaming.feature | "Missing identifier in execution state" | DUPLICATE | Covered by output-formatter.test.ts "when identifier is missing from outputs". |
| specs/prompts/structured-outputs-streaming.feature | "Null value from backend" | DUPLICATE | Covered by output-formatter.test.ts "when value in outputs is null". |
| specs/prompts/structured-outputs-streaming.feature | "Incremental delta streaming for default output identifier" | KEEP | service-adapter.ts:230-236 implements current.slice(lastOutput.length) delta; service-adapter.test.ts has only it.todo placeholder. |
| specs/prompts/structured-outputs-streaming.feature | "Multiple outputs are combined into single JSON object" | DUPLICATE | Covered by output-formatter.test.ts "combines multiple outputs into single JSON object". |
| specs/prompts/structured-outputs-streaming.feature | "Multiple outputs with one null value only shows valid outputs" | DUPLICATE | Covered by output-formatter.test.ts "only includes outputs that have valid values". |
| specs/prompts/structured-outputs-streaming.feature | "Identifier with dashes is normalized by removing dashes" | DUPLICATE | Covered by identifierUtils.test.ts "removes dashes" assertion ("my-custom-score" -> "mycustomscore"). |
| specs/prompts/structured-outputs-streaming.feature | "Identifier with spaces is normalized to underscores" | DUPLICATE | Covered by identifierUtils.test.ts "replaces spaces with underscores". |
| specs/prompts/structured-outputs-streaming.feature | "Identifier with special characters is normalized by removing them" | DUPLICATE | Covered by identifierUtils.test.ts "removes special characters". |
| specs/prompts/structured-outputs-streaming.feature | "Identifier with uppercase is normalized to lowercase" | DUPLICATE | Covered by identifierUtils.test.ts "lowercases the result". |
| specs/prompts/structured-outputs-streaming.feature | "Identifier with underscores is preserved" | DUPLICATE | Covered by identifierUtils.test.ts "preserves underscores". |
| specs/prompts/shorthand-prompt-label-syntax.feature | "Parses tag shorthand from slug:tag format" | DUPLICATE | Covered by parsePromptShorthand.unit.test.ts "when input is slug:tag format" |
| specs/prompts/shorthand-prompt-label-syntax.feature | "Parses version shorthand from slug:number format" | DUPLICATE | Covered by parsePromptShorthand.unit.test.ts "when input is slug:number format" |
| specs/prompts/shorthand-prompt-label-syntax.feature | "Parses bare slug without suffix" | DUPLICATE | Covered by parsePromptShorthand.unit.test.ts "when input is a bare slug" |
| specs/prompts/shorthand-prompt-label-syntax.feature | "Treats "latest" as no tag" | DUPLICATE | Covered by parsePromptShorthand.unit.test.ts "when input has 'latest' suffix" |
| specs/prompts/shorthand-prompt-label-syntax.feature | "Preserves slugs containing a single slash" | DUPLICATE | Covered by parsePromptShorthand.unit.test.ts "when slug contains a slash" |
| specs/prompts/shorthand-prompt-label-syntax.feature | "Rejects empty slug before colon" | DUPLICATE | Covered by parsePromptShorthand.unit.test.ts "when slug is empty before colon" |
| specs/prompts/shorthand-prompt-label-syntax.feature | "Rejects empty suffix after colon" | DUPLICATE | Covered by parsePromptShorthand.unit.test.ts "when suffix after colon is empty" |
| specs/prompts/shorthand-prompt-label-syntax.feature | "Span attribute containing slug:tag shorthand resolves to handle and tag" | DUPLICATE | Covered by parsePromptReference.unit.test.ts "when slug:tag shorthand is present" |
| specs/prompts/shorthand-prompt-label-syntax.feature | "Span attribute containing slug:number shorthand resolves to handle and version" | DUPLICATE | Covered by parsePromptReference.unit.test.ts "resolves slug:number to handle and version" |
| specs/prompts/shorthand-prompt-label-syntax.feature | "Rejects purely numeric tag name during creation" | DUPLICATE | Covered by prompt-tag.service.unit.test.ts "when name is purely numeric" |
| specs/prompts/shorthand-prompt-label-syntax.feature | "Rejects zero as a tag name during creation" | UPDATE | "0" is purely numeric and is rejected, but no test asserts the "0" case specifically; KEEP-style new test fits validateTagName |
| specs/prompts/shorthand-prompt-label-syntax.feature | "Accepts valid non-numeric tag during creation" | UPDATE | validateTagName allows "production"; "allowed tags are production and staging" Given is now misleading — any lowercase slug is allowed |
| specs/prompts/shorthand-prompt-label-syntax.feature | "Rejects "latest" as a tag name during creation" | DUPLICATE | Covered by prompt-tag.service.unit.test.ts "when name is a protected tag" (latest case) |
| specs/prompts/shorthand-prompt-label-syntax.feature | "REST API resolves shorthand in the path" | DUPLICATE | Covered by shorthand-prompt-syntax.integration.test.ts "resolves tag shorthand to the tagged version, not latest" |
| specs/prompts/shorthand-prompt-label-syntax.feature | "REST API rejects shorthand path combined with tag query param" | DUPLICATE | Covered by shorthand-prompt-syntax.integration.test.ts "when shorthand path conflicts with tag query param" |
| specs/prompts/shorthand-prompt-label-syntax.feature | "Malformed shorthand returns 422 not 500" | DUPLICATE | Covered by shorthand-prompt-syntax.integration.test.ts "returns 422 for empty slug (e.g. ':production')" |
| specs/prompts/shorthand-prompt-label-syntax.feature | "Empty suffix shorthand returns 422 not 500" | DUPLICATE | Covered by shorthand-prompt-syntax.integration.test.ts "returns 422 for empty suffix (e.g. 'pizza-prompt:')" |
| specs/prompts/shorthand-prompt-label-syntax.feature | "Shorthand is not parsed in the tag-assignment route" | DUPLICATE | Covered by shorthand-prompt-syntax.integration.test.ts "does not parse shorthand from the prompt ID" |
| specs/prompts/custom-prompt-tags.feature | "Create a custom tag" | UPDATE | Endpoint is POST /api/prompts/tags (org resolved via API key), not /api/orgs/:orgId/prompt-tags; behavior covered by prompt-tags.integration.test.ts |
| specs/prompts/custom-prompt-tags.feature | "Reject numeric tag names" | UPDATE | Wrong URL path; service-level rejection covered by prompt-tag.service.unit.test.ts and REST 422 test |
| specs/prompts/custom-prompt-tags.feature | "Reject empty tag names" | UPDATE | Wrong URL path; covered by REST 422 "when name is empty" test |
| specs/prompts/custom-prompt-tags.feature | "Reject tag names with invalid characters" | UPDATE | Wrong URL path; covered by validateTagName unit tests for uppercase/digits/specials |
| specs/prompts/custom-prompt-tags.feature | "Reject duplicate tag names within the same org" | UPDATE | Wrong URL path; conflict (409) covered by prompt-tags.integration.test.ts "name already exists" |
| specs/prompts/custom-prompt-tags.feature | "Reject tag names that clash with built-in tags" | UPDATE | Wrong URL path; spec says "production" is built-in but only "latest" is in PROTECTED_TAGS — wording also drifted |
| specs/prompts/custom-prompt-tags.feature | "Assign a custom tag to a prompt version" | DUPLICATE | Covered by python-sdk e2e test_assign_custom_tag_then_fetch_by_tag and DeployPromptDialog assign flow |
| specs/prompts/custom-prompt-tags.feature | "List tags returns all org tags" | UPDATE | Endpoint is GET /api/prompts/tags; covered by REST integration test "returns tags with id, name, and createdAt" |
| specs/prompts/custom-prompt-tags.feature | "List tags for an org with no custom tags" | UPDATE | Wrong URL path; covered by "returns an empty array" REST test (note: built-in tags are seeded so "no custom" is conditional) |
| specs/prompts/custom-prompt-tags.feature | "Delete a custom tag removes the definition" | UPDATE | Endpoint is DELETE /api/prompts/tags/:tag (by name), not by tagId; covered by REST integration test "returns 204" |
| specs/prompts/custom-prompt-tags.feature | "Delete a custom tag cascades to assignments" | DUPLICATE | Covered by REST integration test "cascades to remove PromptTagAssignment rows" and python-sdk e2e |
| specs/prompts/custom-prompt-tags.feature | "Cannot delete protected tags" | UPDATE | Spec says "production" but only "latest" is in PROTECTED_TAGS; covered by REST test for "latest" protected |
| specs/prompts/custom-prompt-tags.feature | "Non-admin cannot create custom tags" | KEEP | Authorization scenario; tRPC enforces prompts:manage but no explicit 403 REST test exists for non-admin |
| specs/prompts/custom-prompt-tags.feature | "Tags are scoped to the org on list" | KEEP | Org isolation behavior worth testing; not covered explicitly in existing REST integration tests |
| specs/prompts/custom-prompt-tags.feature | "Cannot delete another org's tag" | KEEP | Cross-org delete protection; org resolution via API key inherently scopes but worth explicit test |
| specs/prompts/sync-auto-detect-variables.feature | "Extracts simple mustache variables from prompt text" | DUPLICATE | covered by mergeAutoDetectedInputs.unit.test.ts "detects variables from prompt text" |
| specs/prompts/sync-auto-detect-variables.feature | "Extracts variables from all messages (system + user)" | DUPLICATE | covered by mergeAutoDetectedInputs.unit.test.ts "detects variables from both prompt and messages" |
| specs/prompts/sync-auto-detect-variables.feature | "Ignores loop iterator variables" | DUPLICATE | covered by mergeAutoDetectedInputs.unit.test.ts "detects collection variable but not loop iterator" and liquidVariableExtraction.unit.test.ts |
| specs/prompts/sync-auto-detect-variables.feature | "Ignores assigned variables" | DUPLICATE | covered by mergeAutoDetectedInputs.unit.test.ts "detects input variable but not assigned variable" |
| specs/prompts/sync-auto-detect-variables.feature | "Handles dot notation by extracting root variable" | DUPLICATE | covered by mergeAutoDetectedInputs.unit.test.ts "extracts root variable only" |
| specs/prompts/sync-auto-detect-variables.feature | "Merges detected variables with explicitly provided inputs" | DUPLICATE | covered by mergeAutoDetectedInputs.unit.test.ts "preserves explicit input and adds auto-detected variable" |
| specs/prompts/sync-auto-detect-variables.feature | "Preserves existing input types when merging" | DUPLICATE | covered by mergeAutoDetectedInputs.unit.test.ts "preserves the explicit type instead of overwriting with str" |
| specs/prompts/sync-auto-detect-variables.feature | "Inputs are sorted alphabetically by identifier for deterministic ordering" | DUPLICATE | covered by mergeAutoDetectedInputs.unit.test.ts "sorts inputs alphabetically by identifier" |
| specs/prompts/sync-auto-detect-variables.feature | "CLI hardcoded "input" default is kept only when it appears in the template" | UPDATE | mergeAutoDetectedInputs preserves CLI default 'input' even when absent from template (pinned first); spec wording contradicts current behavior |
| specs/prompts/sync-auto-detect-variables.feature | "Repeated sync with same variables does not create a new version" | DUPLICATE | covered by syncPromptAutoDetect.integration.test.ts "returns up_to_date because auto-detected inputs match stored inputs" |
| specs/prompts/sync-auto-detect-variables.feature | "Reordering variables in template text does not create a new version" | DUPLICATE | covered by syncPromptAutoDetect.integration.test.ts "returns up_to_date because inputs are sorted alphabetically" |
| specs/prompts/sync-auto-detect-variables.feature | "Auto-detected variables from a complex real-world prompt" | DUPLICATE | covered by mergeAutoDetectedInputs.unit.test.ts "detects all template variables and excludes loop iterators" (altura-demo) |
| specs/prompts/open-trace-in-playground.feature | "Trace without max tokens specified opens in Playground" | DUPLICATE | covered by useLoadSpanIntoPromptPlayground.unit.test.ts "creates form values successfully with undefined maxTokens" |
| specs/prompts/open-trace-in-playground.feature | "Trace without temperature specified opens in Playground" | DUPLICATE | covered by useLoadSpanIntoPromptPlayground.unit.test.ts "creates form values successfully with undefined temperature" |
| specs/prompts/open-trace-in-playground.feature | "Trace with LLM config values opens in Playground with those values" | DUPLICATE | covered by useLoadSpanIntoPromptPlayground.unit.test.ts "preserves maxTokens value" and "preserves temperature value" |
| specs/prompts/open-trace-in-playground.feature | "Trace without a model specified uses the default model" | DUPLICATE | covered by useLoadSpanIntoPromptPlayground.unit.test.ts "uses the default model" |
| specs/prompts/open-trace-in-playground.feature | "Trace with all OTel numeric parameters maps them to the playground" | DUPLICATE | covered by useLoadSpanIntoPromptPlayground.unit.test.ts "populates all numeric parameters in the form" |
| specs/prompts/open-trace-in-playground.feature | "Trace with reasoning effort maps it to the playground" | DUPLICATE | covered by useLoadSpanIntoPromptPlayground.unit.test.ts "populates the reasoning parameter" |
| specs/prompts/open-trace-in-playground.feature | "Trace with string-typed numeric parameters coerces them" | DUPLICATE | covered by useLoadSpanIntoPromptPlayground.integration.test.ts "coerces all string-typed numeric parameters" |
| specs/prompts/open-trace-in-playground.feature | "Trace with unknown or garbage parameter values skips them gracefully" | DUPLICATE | covered by useLoadSpanIntoPromptPlayground.unit.test.ts "leaves uncoercible parameters unset" |
| specs/prompts/open-trace-in-playground.feature | "Trace with only some parameters populates only those" | DUPLICATE | covered by useLoadSpanIntoPromptPlayground.unit.test.ts "populates only temperature and seed" |
| specs/prompts/open-trace-in-playground.feature | "ClickHouse backend extracts all OTel gen_ai.request attributes" | KEEP | LLM_PARAMETER_MAP loop in clickhouse-trace.service.ts extracts all params but no integration test exercises ClickHouse path |
| specs/prompts/open-trace-in-playground.feature | "Elasticsearch backend extracts all parameters from span params" | KEEP | LLM_PARAMETER_MAP loop in elasticsearch-trace.service.ts extracts all params but no integration test exercises ES path |
| specs/prompts/open-trace-in-playground.feature | "Extra unknown parameters from traces go into litellmParams" | KEEP | litellmParams collection logic exists in elasticsearch-trace.service.ts but no test asserts unknown-key routing |
| specs/prompts/python-sdk-prompt-tags.feature | "Fetch prompt by tag" | DUPLICATE | Covered by python-sdk/tests/prompts/test_prompt_tags_integration.py TestFetchByTag::test_sends_tag_query_parameter |
| specs/prompts/python-sdk-prompt-tags.feature | "Fetch without tag returns latest" | DUPLICATE | Covered by python-sdk/tests/prompts/test_prompt_tags_integration.py TestWhenNoTagProvided::test_sends_no_tag_query_parameter |
| specs/prompts/python-sdk-prompt-tags.feature | "Shorthand syntax passes through to API" | DUPLICATE | Covered by python-sdk/tests/prompts/test_prompt_tags.py test_passes_full_string_through_as_prompt_id and e2e test_shorthand_syntax_passes_through_as_id |
| specs/prompts/python-sdk-prompt-tags.feature | "Tagged and untagged fetches return independent results" | DUPLICATE | Covered by python-sdk test_prompt_tags_integration.py TestCacheIsolation::test_api_called_twice_no_cache_collision |
| specs/prompts/python-sdk-prompt-tags.feature | "Fetches with different tags return independent results" | DUPLICATE | Covered by python-sdk test_prompt_tags_integration.py TestWhenDifferentTagsFetched::test_api_called_twice_different_tags |
| specs/prompts/python-sdk-prompt-tags.feature | "Tag with MATERIALIZED_FIRST skips local and fetches from API" | DUPLICATE | Covered by python-sdk test_prompt_tags_integration.py TestTagWithMaterializedFirst::test_skips_local_fetches_from_api |
| specs/prompts/python-sdk-prompt-tags.feature | "Unassigned tag propagates API error" | DUPLICATE | Covered by python-sdk test_prompt_tags_integration.py TestErrorPropagation::test_raises_error_with_api_message |
| specs/prompts/python-sdk-prompt-tags.feature | "Assign tag to existing version" | DUPLICATE | Covered by python-sdk test_prompt_tags_integration.py TestTagAssignment::test_sends_put_request and prompt_tags.py TestPromptApiServiceAssignTag |
| specs/prompts/python-sdk-prompt-tags.feature | "Create prompt with tags" | DUPLICATE | Covered by python-sdk test_prompt_tags_integration.py TestCreateWithTags::test_sends_tags_in_request_body |
| specs/prompts/python-sdk-prompt-tags.feature | "Update prompt with tags" | DUPLICATE | Covered by python-sdk test_prompt_tags_integration.py TestUpdateWithTags::test_sends_tags_in_request_body |
| specs/prompts/prompt-tags.feature | "Assigning a tag to a specific version" | UPDATE | Behavior exists but record name is PromptTagAssignment not PromptVersionTag; rewording needed. Test exists in prompt-tags.integration.test.ts |
| specs/prompts/prompt-tags.feature | "Reassigning a tag to a different version" | DUPLICATE | Covered by prompt-tags.integration.test.ts "when reassigning a tag to a different version" |
| specs/prompts/prompt-tags.feature | "Tags are scoped to their own prompt" | DUPLICATE | Covered by prompt-tags.integration.test.ts "when two prompts each have the same tag name" |
| specs/prompts/prompt-tags.feature | "Only production and staging are valid tags" | DELETE | Stale design — PROTECTED_TAGS=["latest"] only; custom tags supported per custom-prompt-tags.feature; "canary" is now valid |
| specs/prompts/prompt-tags.feature | "Fetching a prompt by tag returns the taged version" | KEEP | Behavior implemented (prompts-api routes resolve ?tag=); no e2e test for ?tag=production/?tag=staging path yet |
| specs/prompts/prompt-tags.feature | "Fetching a prompt without a tag returns the latest version" | KEEP | Default-latest behavior implemented in PromptService; deserves an explicit e2e on /api/prompts/:id with no tag |
| specs/prompts/prompt-tags.feature | "Fetching a prompt via tRPC with a tag parameter" | DUPLICATE | Covered by prompt-tags.integration.test.ts "when fetching a prompt via service with a tag parameter" |
| specs/prompts/prompt-tags.feature | "Fetching with both version and tag is rejected" | DUPLICATE | Covered by prompt-tags.integration.test.ts "when fetching with both version and tag" (version + versionId variants) |
| specs/prompts/prompt-tags.feature | "Fetching with an unassigned tag returns an error" | DUPLICATE | Covered by prompt-tags.integration.test.ts "when fetching with an unassigned tag" (NotFoundError) |
| specs/prompts/prompt-tags.feature | "Tag must reference a version belonging to the same prompt" | DUPLICATE | Covered by prompt-tags.integration.test.ts "when assigning a tag to an organization-scoped prompt" cross-config guard |
| specs/prompts/deploy-prompt-dialog.feature | "Open deploy dialog from prompt toolbar" | UPDATE | Description copy in spec drifted: code reads "Use tags to get specific prompt versions via the SDK and API. Prompt versions with the production tag are returned by default." |
| specs/prompts/deploy-prompt-dialog.feature | "Dialog shows all label rows" | DUPLICATE | Covered by DeployPromptDialog.integration.test.tsx "displays the latest row with current version number" + production/staging dropdown rows |
| specs/prompts/deploy-prompt-dialog.feature | "Version dropdown shows context" | DUPLICATE | Covered by DeployPromptDialog.integration.test.tsx "lists versions newest first with commit messages" |
| specs/prompts/deploy-prompt-dialog.feature | "Production and staging rows have version dropdowns" | DUPLICATE | Covered by DeployPromptDialog.integration.test.tsx "displays the production row with a dropdown" and staging equivalent |
| specs/prompts/deploy-prompt-dialog.feature | "Assign production to a version" | DUPLICATE | Covered by DeployPromptDialog.integration.test.tsx "calls assignTag with the selected production version" — but Save button label is "Save", not "Save changes" |
| specs/prompts/deploy-prompt-dialog.feature | "Change staging version" | DUPLICATE | Covered by DeployPromptDialog.integration.test.tsx "calls assignTag with the selected staging version" — also Save button mismatch |
| specs/prompts/deploy-prompt-dialog.feature | "Fetch all labels for a prompt config" | UPDATE | Method is getTagsForConfig (returns PromptTagAssignment with promptTag), not getLabelsForConfig; covered by llm-config-tag.repository.unit.test.ts |
| specs/prompts/deploy-prompt-dialog.feature | "getLabelsForConfig returns empty when no labels assigned" | UPDATE | Method is getTagsForConfig; covered by llm-config-tag.repository.unit.test.ts "when no tags are assigned returns an empty list" |
| specs/prompts/prompt-soft-delete.feature | "Deleting a prompt marks it as deleted but preserves the record" | DUPLICATE | covered by llm-config.soft-delete.unit.test.ts "soft-deletes by setting deletedAt" and "filters out soft-deleted prompts" |
| specs/prompts/prompt-soft-delete.feature | "A user can reuse the handle of an archived prompt for a new prompt" | KEEP | handle-nulling on delete is unit tested but no integration test verifies create-with-reused-handle end-to-end |
| specs/prompts/prompt-soft-delete.feature | "A user can sync a fresh prompt from the CLI after the previous one was archived" | KEEP | handle-nulling enables CLI sync but no integration test exercises post-archive sync flow via CLI/REST |

## Summary

**Total `@unimplemented` scenarios audited**: 250

### Class breakdown

| Class | Count | % | Phase 1 action |
|-------|------:|--:|----------------|
| KEEP | 51 | 20.4% | Bind a test (Phase 3) |
| UPDATE | 36 | 14.4% | Rewrite scenario (Phase 1) → bind test (Phase 3) |
| DELETE | 2 | 0.8% | Remove from spec (Phase 1) |
| DUPLICATE | 161 | 64.4% | Remove + cross-link to existing test (Phase 1) |

**Cull candidates** (DELETE + DUPLICATE): 163 (65.2% of audited)

### Per-file breakdown

| File | Total | KEEP | UPDATE | DELETE | DUPLICATE |
|------|------:|-----:|-------:|-------:|----------:|
| `template-logic-autocomplete.feature` | 35 | 7 | 7 | 0 | 21 |
| `liquid-template-support.feature` | 32 | 2 | 0 | 0 | 30 |
| `prompt-selection-drawer.feature` | 30 | 12 | 10 | 1 | 7 |
| `open-existing-prompt-from-trace.feature` | 26 | 13 | 0 | 0 | 13 |
| `custom-labels-deploy-dialog.feature` | 20 | 6 | 2 | 0 | 12 |
| `structured-outputs-streaming.feature` | 19 | 1 | 0 | 0 | 18 |
| `shorthand-prompt-label-syntax.feature` | 18 | 0 | 2 | 0 | 16 |
| `custom-prompt-tags.feature` | 15 | 3 | 10 | 0 | 2 |
| `sync-auto-detect-variables.feature` | 12 | 0 | 1 | 0 | 11 |
| `open-trace-in-playground.feature` | 12 | 3 | 0 | 0 | 9 |
| `python-sdk-prompt-tags.feature` | 10 | 0 | 0 | 0 | 10 |
| `prompt-tags.feature` | 10 | 2 | 1 | 1 | 6 |
| `deploy-prompt-dialog.feature` | 8 | 0 | 3 | 0 | 5 |
| `prompt-soft-delete.feature` | 3 | 2 | 0 | 0 | 1 |

### Notes from audit

- **DUPLICATE density is high (64%)** because many feature files describe behavior that already has unit/integration coverage in `langwatch/src/server/prompt-config/__tests__/`, `langwatch/src/prompts/**/__tests__/`, `langwatch/src/components/prompts/__tests__/`, and `python-sdk/tests/prompts/`. The `@unimplemented` tag in PR #3298 was applied to "no JSDoc binding," not "no test." Phase 1 should remove these scenarios and add `@scenario` JSDoc backlinks to the existing tests, or — where the spec adds value beyond the test — keep one canonical scenario.
- **UPDATE rows cluster on copy / field-name drift** (e.g., DeployPromptDialog button labels, PromptVersionTag → PromptTagAssignment, REST URL paths). These need scenario rewrites before any test bind.
- **DELETE is sparse (2 rows)** — only one `@future @unimplemented` aspirational scenario in `prompt-selection-drawer.feature` and one outdated tag-validity claim in `prompt-tags.feature`. Most "stale" content is actually duplicate, not aspirational.
- **DUPLICATE rationales include the test that covers the scenario** so Phase 1 can cross-link without re-research.
