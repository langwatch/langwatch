# model-config audit manifest (unimpl tag classification)

Audit of every `@unimpl`​`emented` scenario in `specs/model-config/`. Each row classifies a scenario for Phase 1 / Phase 3 action per `~/workspace/orchard-codex/plans/unimpl-reduction-2026-04-25.md`.

Classes:
- **KEEP** — scenario describes intended behavior; bind a test in Phase 3.
- **UPDATE** — behavior changed; rewrite scenario then bind.
- **DELETE** — aspirational/stale; remove from spec.
- **DUPLICATE** — already covered by an existing test or another scenario; cross-link in Phase 1.

Investigation anchors:
- `langwatch/src/server/modelProviders/modelIdBoundary.ts` (+ `__tests__/modelIdBoundary.unit.test.ts`)
- `langwatch/src/server/prompt-config/reasoningBoundary.ts` (+ `__tests__/reasoningBoundary.unit.test.ts`)
- `langwatch/src/server/api/routers/modelProviders.utils.ts` (`prepareLitellmParams`, `getParameterConstraints`)
- `langwatch/src/server/modelProviders/registry.ts` (`parameterConstraints`, `reasoningConfig`)
- `langwatch/src/components/llmPromptConfigs/LLMConfigPopover.tsx` (+ `__tests__/LLMConfigPopover.test.tsx`)
- `langwatch/src/components/llmPromptConfigs/parameterConfig.ts` (+ `__tests__/parameterConfig.unit.test.ts`)
- `langwatch/src/components/ModelSelector.tsx`
- `langwatch_nlp/langwatch_nlp/studio/dspy/template_adapter.py` (`_filter_empty_content_messages`)
- `langwatch_nlp/langwatch_nlp/studio/utils.py` (`translate_model_id_for_litellm`, `map_reasoning_to_provider`)
- No `syncModelRegistry` script exists anywhere in the tree (verified via `find` + `grep`).

| File | Scenario | Class | Rationale |
|------|----------|-------|-----------|
| specs/model-config/anthropic-empty-content.feature | "Filters empty system message when instructions are empty" | KEEP | Python `_filter_empty_content_messages` filters empty/whitespace messages, but no test asserts the empty-instructions→omit-system-message path specifically; bind a Python unit test |
| specs/model-config/anthropic-empty-content.feature | "Filters system message with only whitespace" | KEEP | Same — Python adapter strips whitespace but no spec-bound assertion exists |
| specs/model-config/anthropic-empty-content.feature | "Preserves non-empty system message" | KEEP | Positive-path assertion missing; pair with the two filter scenarios |
| specs/model-config/anthropic-empty-content.feature | "Filters empty text content blocks from list content" | KEEP | List-content filtering is the core behavior of `_filter_empty_content_messages`; bind a unit test against the Python helper |
| specs/model-config/anthropic-empty-content.feature | "Removes message entirely if all content blocks are empty" | KEEP | Behavior implemented in the Python adapter, no test bound |
| specs/model-config/anthropic-empty-content.feature | "Handles mixed content types (preserves non-text blocks)" | KEEP | Behavior described matches adapter intent, no spec-bound test |
| specs/model-config/anthropic-empty-content.feature | "String content filtering" | KEEP | Adapter handles string content path; no test bound |
| specs/model-config/anthropic-empty-content.feature | "String content with whitespace" | KEEP | Companion to "String content filtering"; bind together |
| specs/model-config/anthropic-empty-content.feature | "Template variables rendering to empty" | KEEP | End-to-end Jinja-render → filter path, behavior valid; bind an integration test on `template_adapter.py` |
| specs/model-config/litellm-model-id-translation.feature | "Translates Anthropic Claude Opus 4.5 model ID" | DUPLICATE | Covered by `modelIdBoundary.unit.test.ts` — `translates anthropic/claude-opus-4.5 to anthropic/claude-opus-4-5` |
| specs/model-config/litellm-model-id-translation.feature | "Translates Anthropic Claude Sonnet 4.5 model ID" | DUPLICATE | Covered by `modelIdBoundary.unit.test.ts` — `translates anthropic/claude-sonnet-4.5 to anthropic/claude-sonnet-4-5` |
| specs/model-config/litellm-model-id-translation.feature | "Translates Anthropic Claude 3.5 Haiku model ID with alias expansion" | DUPLICATE | Covered by `modelIdBoundary.unit.test.ts` alias-expansion case for `claude-3.5-haiku` |
| specs/model-config/litellm-model-id-translation.feature | "Translates Anthropic Claude 3.7 Sonnet model ID" | DUPLICATE | Covered by `modelIdBoundary.unit.test.ts` — `translates anthropic/claude-3.7-sonnet to anthropic/claude-3-7-sonnet` |
| specs/model-config/litellm-model-id-translation.feature | "Translates Anthropic Claude 3.5 Sonnet model ID" | UPDATE | Spec asserts `anthropic/claude-3-5-sonnet`, but `MODEL_ALIASES` maps to dated `anthropic/claude-3-5-sonnet-20240620`; rewrite scenario before binding |
| specs/model-config/litellm-model-id-translation.feature | "Preserves OpenAI model IDs unchanged" | DUPLICATE | Covered by `modelIdBoundary.unit.test.ts` — `preserves openai/gpt-5 unchanged` |
| specs/model-config/litellm-model-id-translation.feature | "Preserves Gemini model IDs unchanged" | DUPLICATE | Covered by `modelIdBoundary.unit.test.ts` — `preserves gemini/gemini-2.5-pro unchanged` |
| specs/model-config/litellm-model-id-translation.feature | "Preserves Anthropic models without dots unchanged" | DUPLICATE | Covered by `modelIdBoundary.unit.test.ts` — `preserves anthropic/claude-3-opus unchanged` |
| specs/model-config/litellm-model-id-translation.feature | "Handles model ID with multiple dots" | DUPLICATE | Covered by `modelIdBoundary.unit.test.ts` — `converts all dots in anthropic/claude-opus-4.5.1` |
| specs/model-config/litellm-model-id-translation.feature | "Preserves custom provider prefix" | DUPLICATE | Covered by `modelIdBoundary.unit.test.ts` — `translates custom/claude-opus-4.5 to custom/claude-opus-4-5` |
| specs/model-config/litellm-model-id-translation.feature | "Translates claude-sonnet-4 alias to full dated version" | DUPLICATE | Covered by `modelIdBoundary.unit.test.ts` — alias expansion test for `claude-sonnet-4` |
| specs/model-config/litellm-model-id-translation.feature | "Translates claude-opus-4 alias to full dated version" | DUPLICATE | Covered by `modelIdBoundary.unit.test.ts` — alias expansion test for `claude-opus-4` |
| specs/model-config/litellm-model-id-translation.feature | "prepareLitellmParams translates Anthropic model ID" | KEEP | `prepareLitellmParams` calls `translateModelIdForLitellm` but `prepareLitellmParams.unit.test.ts` only covers Azure path; bind an Anthropic-translation unit test |
| specs/model-config/litellm-model-id-translation.feature | "prepareLitellmParams preserves OpenAI model ID" | KEEP | Companion to the above; same gap in `prepareLitellmParams.unit.test.ts` |
| specs/model-config/litellm-model-id-translation.feature | "Anthropic API call succeeds with translated model ID" | KEEP | Live-API integration test with real credentials; gated on env, not currently bound |
| specs/model-config/litellm-model-id-translation.feature | "End-to-end prompt execution with Anthropic Claude 3.5 Haiku" | KEEP | E2E playground execution path; not currently bound to any test |
| specs/model-config/litellm-reasoning-params.feature | "TypeScript boundary layer uses reasoning_effort for Anthropic" | DUPLICATE | Covered by `reasoningBoundary.unit.test.ts` — `maps reasoning to reasoning_effort for Anthropic models` |
| specs/model-config/litellm-reasoning-params.feature | "TypeScript boundary layer uses reasoning_effort for Gemini" | DUPLICATE | Covered by `reasoningBoundary.unit.test.ts` — `maps reasoning to reasoning_effort for Gemini models` |
| specs/model-config/litellm-reasoning-params.feature | "TypeScript boundary layer uses reasoning_effort for OpenAI" | DUPLICATE | Covered by `reasoningBoundary.unit.test.ts` — `maps reasoning to reasoning_effort for OpenAI models` |
| specs/model-config/litellm-reasoning-params.feature | "Python boundary layer uses reasoning_effort for Anthropic" | KEEP | Python `node_llm_config_to_dspy_lm` mapping not covered by any TS-side test; bind a Python unit test |
| specs/model-config/litellm-reasoning-params.feature | "Python boundary layer uses reasoning_effort for Gemini" | KEEP | Same — Python-side mapping, no test bound |
| specs/model-config/litellm-reasoning-params.feature | "Jinja macro uses reasoning_effort for all providers" | KEEP | Jinja macro rendering for `node_llm_config_to_dspy_lm`; no test bound |
| specs/model-config/litellm-reasoning-params.feature | "Translates registry parameterName 'effort' to reasoning_effort" | DUPLICATE | Covered by `reasoningBoundary.unit.test.ts` — `LITELLM_PARAMETER_TRANSLATION` test `maps effort to reasoning_effort` |
| specs/model-config/litellm-reasoning-params.feature | "Translates registry parameterName 'thinkingLevel' to reasoning_effort" | DUPLICATE | Covered by `reasoningBoundary.unit.test.ts` — `maps thinkingLevel to reasoning_effort` |
| specs/model-config/litellm-reasoning-params.feature | "Passes through reasoning_effort unchanged" | DUPLICATE | Covered by `reasoningBoundary.unit.test.ts` — `maps reasoning_effort to reasoning_effort (passthrough)` |
| specs/model-config/litellm-reasoning-params.feature | "Normalizes effort from database to reasoning" | DUPLICATE | Covered by `reasoningBoundary.unit.test.ts` — `normalizes effort to reasoning` |
| specs/model-config/litellm-reasoning-params.feature | "Normalizes thinkingLevel from database to reasoning" | DUPLICATE | Covered by `reasoningBoundary.unit.test.ts` — `normalizes thinkingLevel to reasoning` |
| specs/model-config/litellm-reasoning-params.feature | "Priority order when multiple fields present" | DUPLICATE | Covered by `reasoningBoundary.unit.test.ts` — `reasoning takes precedence over reasoning_effort` and the priority-order tests |
| specs/model-config/model-parameter-constraints.feature | "Anthropic provider has temperature max 1.0" | DUPLICATE | Covered by `registry.unit.test.ts` lines ~511-513 asserting `modelProviders.anthropic.parameterConstraints.temperature` |
| specs/model-config/model-parameter-constraints.feature | "OpenAI provider uses global defaults" | KEEP | `getParameterConstraints` returning undefined for OpenAI is implied but not asserted; bind a unit test |
| specs/model-config/model-parameter-constraints.feature | "Unknown provider returns undefined constraints" | KEEP | Edge case for `getParameterConstraints("unknown-provider/x")`; not covered by current registry tests |
| specs/model-config/model-parameter-constraints.feature | "Model ID without provider prefix returns undefined" | KEEP | Edge case — no test bound for prefix-less model id input to `getParameterConstraints` |
| specs/model-config/model-parameter-constraints.feature | "Clamping temperature above provider max" | KEEP | Python clamping helper exists in `langwatch_nlp/studio/utils.py` (mirrors registry constraints); needs Python unit test bind |
| specs/model-config/model-parameter-constraints.feature | "Clamping temperature below provider min" | KEEP | Same — Python clamping path, no test bound |
| specs/model-config/model-parameter-constraints.feature | "Value within constraints unchanged" | KEEP | Pass-through positive case; needs a Python unit test |
| specs/model-config/model-parameter-constraints.feature | "Provider without constraints returns original value" | KEEP | Python clamping fallback path; no test bound |
| specs/model-config/model-parameter-constraints.feature | "Temperature slider respects Anthropic constraints" | KEEP | `LLMConfigPopover` reads `parameterConstraints` for slider min/max, but `LLMConfigPopover.test.tsx` does not assert per-provider slider bounds; bind an integration test |
| specs/model-config/model-parameter-constraints.feature | "Temperature slider uses global defaults for OpenAI" | KEEP | Companion to the above — global-default fallback path not asserted |
| specs/model-config/model-parameter-constraints.feature | "Switching from OpenAI to Anthropic updates slider constraints" | KEEP | Model-switch clamp behavior — needs an integration test bind |
| specs/model-config/model-parameter-constraints.feature | "Input field respects provider constraints" | KEEP | Input-field clamping on blur — UI behavior, no test bound |
| specs/model-config/model-parameter-constraints.feature | "Backend clamps out-of-range temperature for Anthropic" | KEEP | Defense-in-depth NLP-service clamp; bind a Python integration test |
| specs/model-config/model-parameter-display.feature | "Shows temperature for traditional models" | DUPLICATE | Covered by `LLMConfigPopover.test.tsx` — `shows Temperature parameter` for traditional models (GPT-4.1) |
| specs/model-config/model-parameter-display.feature | "Shows reasoning effort for reasoning models" | DUPLICATE | Covered by `LLMConfigPopover.test.tsx` — `shows reasoning parameter row` and `displays dynamic label based on reasoningConfig.parameterName` |
| specs/model-config/model-parameter-display.feature | "Shows verbosity for GPT-5 models" | KEEP | Verbosity-specific render not asserted in current popover tests; bind an integration test |
| specs/model-config/model-parameter-display.feature | "Does not show temperature for reasoning-only models" | DUPLICATE | Covered by `LLMConfigPopover.test.tsx` — `does not show Temperature parameter` for reasoning models |
| specs/model-config/model-parameter-display.feature | "Shows top_p for models that support it" | DUPLICATE | Covered by `LLMConfigPopover.test.tsx` — `shows Top P parameter` for traditional models |
| specs/model-config/model-parameter-display.feature | "Shows penalty parameters when supported" | DUPLICATE | Covered by `LLMConfigPopover.test.tsx` — `shows Frequency Penalty parameter` and `shows Presence Penalty parameter` |
| specs/model-config/model-parameter-display.feature | "Max tokens slider respects model limits" | KEEP | `dynamicMax` is wired but no test asserts the slider max equals `maxCompletionTokens`; bind a popover integration test |
| specs/model-config/model-parameter-display.feature | "Max tokens slider shows sensible default" | KEEP | Default-quarter-of-context behavior is undocumented in tests; bind an integration test |
| specs/model-config/model-parameter-display.feature | "Max tokens slider has minimum of 256" | KEEP | Slider min not currently asserted in tests; bind a popover integration test |
| specs/model-config/model-parameter-display.feature | "Shows default parameters for unknown models" | KEEP | `DEFAULT_SUPPORTED_PARAMETERS` fallback is implemented in `getDisplayParameters`, but the unknown-model UI path is not asserted in popover tests |
| specs/model-config/model-parameter-display.feature | "Changing temperature updates the config" | KEEP | onChange-from-slider behavior not asserted in popover tests; bind an integration test |
| specs/model-config/model-parameter-display.feature | "Changing reasoning effort updates the config" | KEEP | onChange for reasoning select not asserted; bind an integration test |
| specs/model-config/model-parameter-display.feature | "Changing max tokens updates the config" | KEEP | onChange for max_tokens not asserted; bind an integration test |
| specs/model-config/model-parameter-display.feature | "Parameters update when switching models" | KEEP | Model-switch parameter visibility — bind an integration test that swaps `model` prop and asserts visible params |
| specs/model-config/model-parameter-display.feature | "No validation errors when switching to reasoning model" | KEEP | Switch to GPT-5.2 with prior temperature should not error; behavior valid, bind an integration test |
| specs/model-config/model-parameter-display.feature | "Preserves compatible parameter values when switching models" | KEEP | Cross-model max_tokens preservation — bind an integration test |
| specs/model-config/model-registry-sync.feature | "Fetches all models from the API" | DELETE | No `syncModelRegistry` script exists in the repo; OpenRouter fetch never implemented (PR #1115 added the spec but not the script) |
| specs/model-config/model-registry-sync.feature | "Handles API errors gracefully" | DELETE | Same — script does not exist |
| specs/model-config/model-registry-sync.feature | "Maps OpenRouter provider names to litellm format" | DELETE | Same — provider mapping logic not present in tree |
| specs/model-config/model-registry-sync.feature | "Preserves provider names that already match" | DELETE | Same — sync script does not exist |
| specs/model-config/model-registry-sync.feature | "Preserves provider names for anthropic" | DELETE | Same — sync script does not exist |
| specs/model-config/model-registry-sync.feature | "Preserves unknown provider names as-is" | DELETE | Same — sync script does not exist |
| specs/model-config/model-registry-sync.feature | "Transforms basic pricing to cost per token format" | DELETE | Pricing transform logic non-existent — no sync script ever ran |
| specs/model-config/model-registry-sync.feature | "Preserves cache pricing when available" | DELETE | Same — no sync script |
| specs/model-config/model-registry-sync.feature | "Preserves image pricing when available" | DELETE | Same — no sync script |
| specs/model-config/model-registry-sync.feature | "Preserves audio pricing when available" | DELETE | Same — no sync script |
| specs/model-config/model-registry-sync.feature | "Preserves internal reasoning pricing when available" | DELETE | Same — no sync script |
| specs/model-config/model-registry-sync.feature | "Extracts supported parameters" | DELETE | Same — no sync script |
| specs/model-config/model-registry-sync.feature | "Handles models without supported parameters" | DELETE | Same — no sync script |
| specs/model-config/model-registry-sync.feature | "Extracts context length and max completion tokens" | DELETE | Same — no sync script |
| specs/model-config/model-registry-sync.feature | "Determines mode from modality" | DELETE | Same — no sync script |
| specs/model-config/model-registry-sync.feature | "Identifies embedding models" | DELETE | Same — no sync script |
| specs/model-config/model-registry-sync.feature | "Detects image input support from input_modalities" | DELETE | Same — no sync script |
| specs/model-config/model-registry-sync.feature | "Detects audio input support from input_modalities" | DELETE | Same — no sync script |
| specs/model-config/model-registry-sync.feature | "Detects image output support from output_modalities" | DELETE | Same — no sync script |
| specs/model-config/model-registry-sync.feature | "Detects audio output support from output_modalities" | DELETE | Same — no sync script |
| specs/model-config/model-registry-sync.feature | "Text-only models have no multimodal flags" | DELETE | Same — no sync script |
| specs/model-config/model-registry-sync.feature | "Saves transformed data to JSON file" | DELETE | Same — output writer non-existent |
| specs/model-config/model-registry-sync.feature | "Output includes all providers from API" | DELETE | Same — no sync script |
| specs/model-config/model-registry-sync.feature | "Fetches embedding models from separate API endpoint" | DELETE | Same — embeddings endpoint fetch non-existent |
| specs/model-config/model-registry-sync.feature | "Merges chat and embedding models in output" | DELETE | Same — no sync script |
| specs/model-config/model-registry-sync.feature | "Embedding models have mode set to embedding" | DELETE | Same — no sync script |
| specs/model-config/model-registry-sync.feature | "Embedding models have correct pricing structure" | DELETE | Same — no sync script |
| specs/model-config/model-registry-sync.feature | "Embedding models are accessible via embedding mode filter" | DELETE | Same — no sync script |
| specs/model-config/model-registry-sync.feature | "Handles embeddings API error gracefully" | DELETE | Same — no sync script |
| specs/model-config/model-registry-sync.feature | "Logs embedding model count in stats" | DELETE | Same — no sync script |
| specs/model-config/model-selector-ux.feature | "Shows model name with provider icon in trigger" | KEEP | `ModelSelector.tsx` renders provider icon + model name in trigger but no test asserts it; bind a component test |
| specs/model-config/model-selector-ux.feature | "Shows key parameter value in trigger subtitle" | KEEP | Trigger subtitle is not visible in `ModelSelector.tsx` top file body; behavior valid intent — bind a component test once UI confirmed |
| specs/model-config/model-selector-ux.feature | "Shows temperature in trigger for traditional models" | KEEP | Companion to above; trigger-subtitle render path needs a component test |
| specs/model-config/model-selector-ux.feature | "Groups models by provider" | KEEP | `useModelSelectionOptions` returns `groupedByProvider`; no test asserts the rendered groups; bind a component test |
| specs/model-config/model-selector-ux.feature | "Shows provider icon next to each model" | KEEP | Implementation present; no test asserts each option's icon; bind a component test |
| specs/model-config/model-selector-ux.feature | "Supports search/filter functionality" | KEEP | `modelSearch` filters groups in `ModelSelector.tsx`; bind a component test for the filter |
| specs/model-config/model-selector-ux.feature | "Search is case-insensitive" | KEEP | Filter uses `.toLowerCase()`; bind a companion component test |
| specs/model-config/model-selector-ux.feature | "Selecting a model updates the config" | KEEP | onChange path through Chakra `Select`; bind a component interaction test |
| specs/model-config/model-selector-ux.feature | "Shows only enabled providers" | KEEP | Provider-disabled filtering — needs to check `getCustomModels` / `modelProviders` enabled flag; bind a component test |
| specs/model-config/model-selector-ux.feature | "Shows custom models added by user" | KEEP | `customModelIdSet` is built and rendered in `useModelSelectionOptions`; bind a component test |
| specs/model-config/model-selector-ux.feature | "Quick access to model provider settings" | KEEP | `showConfigureAction` prop renders a Settings link; `LLMConfigPopover.test.tsx` verifies the prop is passed but does not click-through; bind a component test |
| specs/model-config/model-selector-ux.feature | "Supports keyboard navigation in dropdown" | DELETE | Inline comment says "no test - handled by Chakra UI Select component"; aspirational visual scenario for a third-party component |
| specs/model-config/model-selector-ux.feature | "Escape closes the dropdown" | DELETE | Same — Chakra-handled, the spec author already noted "no test"; remove |
| specs/model-config/model-selector-ux.feature | "Shows loading state while fetching models" | KEEP | `api.modelProvider.getAllForProject` may be loading; no skeleton/loading-state assertion in tests; bind a component test |
| specs/model-config/model-selector-ux.feature | "Handles unknown model in config gracefully" | KEEP | `isUnknown` branch in `ModelSelector.tsx` renders the raw model id in gray; bind a component test |
| specs/model-config/unified-reasoning-form.feature | "Form schema accepts reasoning field with valid value" | KEEP | Form schema validation — needs a unit test against the prompt-config form Zod schema |
| specs/model-config/unified-reasoning-form.feature | "Form schema accepts reasoning field with 'low' value" | KEEP | Same — schema-validation unit test |
| specs/model-config/unified-reasoning-form.feature | "Form schema accepts reasoning field with 'medium' value" | KEEP | Same — schema-validation unit test |
| specs/model-config/unified-reasoning-form.feature | "Form schema accepts undefined reasoning" | KEEP | Same — schema optionality unit test |
| specs/model-config/unified-reasoning-form.feature | "formValuesToTriggerSaveVersionParams includes reasoning" | KEEP | `formValuesToTriggerSaveVersionParams` is exported and used by `PromptEditorDrawer`; only mocked in tests, not unit-tested directly |
| specs/model-config/unified-reasoning-form.feature | "formValuesToTriggerSaveVersionParams handles undefined reasoning" | KEEP | Companion to above — undefined-reasoning round-trip not unit-tested |
| specs/model-config/unified-reasoning-form.feature | "versionedPromptToPromptConfigFormValues maps reasoning correctly" | KEEP | `versionedPromptToPromptConfigFormValuesWithSystemMessage` (current name) round-trip not unit-tested for reasoning field |
| specs/model-config/unified-reasoning-form.feature | "versionedPromptToPromptConfigFormValues handles missing reasoning" | KEEP | Companion — missing-reasoning normalization not unit-tested |
| specs/model-config/unified-reasoning-form.feature | "Form values round-trip preserves reasoning" | KEEP | Round-trip integration test — bind once unit tests above are in place |
| specs/model-config/unified-reasoning-ui.feature | "Shows single Reasoning dropdown for OpenAI reasoning model" | DUPLICATE | Covered by `LLMConfigPopover.test.tsx` — `displays dynamic label based on reasoningConfig.parameterName` and `shows reasoning parameter row` for GPT-5 |
| specs/model-config/unified-reasoning-ui.feature | "Shows single Reasoning dropdown for Gemini reasoning model" | KEEP | Gemini-specific `reasoningConfig` rendering not asserted in current popover tests |
| specs/model-config/unified-reasoning-ui.feature | "Shows single Reasoning dropdown for Anthropic reasoning model" | KEEP | Anthropic-specific `reasoningConfig` rendering not asserted in current popover tests |
| specs/model-config/unified-reasoning-ui.feature | "Shows extended options for models with more reasoning levels" | KEEP | Five-option case (`xhigh` etc.) not currently asserted; bind an integration test |
| specs/model-config/unified-reasoning-ui.feature | "Does not show Reasoning dropdown for non-reasoning models" | DUPLICATE | Covered by `LLMConfigPopover.test.tsx` — `does not show Reasoning parameter` for GPT-4.1 |
| specs/model-config/unified-reasoning-ui.feature | "Selecting reasoning value updates form with unified field" | KEEP | onChange-from-reasoning-select asserting `llm.reasoning` (and not `reasoningEffort`) — not currently bound |
| specs/model-config/unified-reasoning-ui.feature | "Changing reasoning value triggers onChange callback" | KEEP | onChange callback assertion for reasoning select — needs a popover integration test |
| specs/model-config/unified-reasoning-ui.feature | "Reasoning options come from model's reasoningConfig.allowedValues" | KEEP | Dynamic options resolution — `getParameterConfigWithModelOverrides` is unit-tested in `parameterConfig.unit.test.ts`, but the popover-render-of-options is not bound |
| specs/model-config/unified-reasoning-ui.feature | "Reasoning default comes from model's reasoningConfig.defaultValue" | KEEP | Default-value assertion in popover not bound |
| specs/model-config/unified-reasoning-ui.feature | "Reasoning dropdown updates when switching between reasoning models" | KEEP | Reasoning-options re-resolve on model switch — not asserted |
| specs/model-config/unified-reasoning-ui.feature | "Reasoning dropdown disappears when switching to non-reasoning model" | KEEP | Disappear-on-switch — not asserted |
| specs/model-config/unified-reasoning-ui.feature | "Reasoning dropdown is keyboard accessible" | DELETE | Keyboard nav on Chakra `Select` — same rationale as the model-selector-ux Chakra-handled scenarios; aspirational for a third-party component |
| specs/model-config/unified-reasoning.feature | "Uses model reasoningConfig.parameterName when available" | DUPLICATE | Covered by `reasoningBoundary.unit.test.ts` — `passes through custom_reasoning unchanged (not in translation map)` exercises the model-`reasoningConfig.parameterName` branch |
| specs/model-config/unified-reasoning.feature | "Returns undefined when reasoning is not set" | DUPLICATE | Covered by `reasoningBoundary.unit.test.ts` — `returns undefined when reasoning is undefined` |
| specs/model-config/unified-reasoning.feature | "reasoning takes precedence over provider-specific fields" | DUPLICATE | Covered by `reasoningBoundary.unit.test.ts` — `reasoning takes precedence over reasoning_effort` and the `over all provider-specific fields` test |
| specs/model-config/unified-reasoning.feature | "Falls back through provider-specific fields if reasoning not set" | DUPLICATE | Covered by `reasoningBoundary.unit.test.ts` — `normalizes effort to reasoning` and the priority-order tests |
| specs/model-config/unified-reasoning.feature | "Falls back in priority order reasoning > reasoning_effort > thinkingLevel > effort" | DUPLICATE | Covered by `reasoningBoundary.unit.test.ts` — `follows priority: reasoning > reasoning_effort > thinkingLevel > effort` |
| specs/model-config/unified-reasoning.feature | "Returns undefined when no reasoning fields are set" | DUPLICATE | Covered by `reasoningBoundary.unit.test.ts` — `returns undefined when all fields are undefined` |
</content>
</invoke>