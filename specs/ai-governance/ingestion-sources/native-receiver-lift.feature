Feature: Native receiver-side lift via canonicalisation extractor pipeline
  Platform-known coding-agent tools (claude_code, codex, gemini,
  opencode, cursor) emit OpenTelemetry log records on their own
  scopes. LangWatch lifts model, cost, tokens, cache split, and
  thread.id off those records onto canonical `langwatch.*` attributes
  natively in the receiver — through the same canonical extractor
  pipeline that already handles span-side framework detection
  (GenAI / Mastra / Vercel / Traceloop / Logfire / Strands / Haystack).

  Architecture decision: each platform tool is a class under
  `langwatch/src/server/app-layer/traces/canonicalisation/extractors/`
  that implements the `applyLog(LogExtractorContext)` method on the
  `CanonicalAttributesExtractor` interface. The trace-processing log
  fold projection runs the registry via
  `liftCanonicalAttributesFromLogRecord` and merges canonical keys
  into the trace summary. Adding a new platform tool is a one-line
  extractor + one registry line, with no bespoke per-tool branch in
  the fold.

  OTTL (`parserConfig.ottlStatements`) stays as the future-extensible
  catch-all on top: any IngestionSource whose statements are
  non-empty round-trips through `/internal/transform` regardless of
  sourceType, so admins can layer custom field mappings even on
  platform-native tools.

  As a developer running Claude Code / Codex / Gemini CLI / opencode
  on their `/me` ingestion endpoint, my session's cost, tokens,
  model, and conversation grouping land on the trace summary without
  the admin needing to author OTTL statements per tool.

  Background:
    Given a project "acme" with the trace-processing pipeline running
    And the canonical extractor registry includes ClaudeCodeExtractor,
      CodexExtractor, GenAIExtractor, and SpringAIExtractor

  Scenario: ClaudeCodeExtractor lifts api_request fields onto canonical attributes
    Given a log record with scopeName "com.anthropic.claude_code.events"
    And attribute "event.name" is "api_request"
    And attribute "model" is "claude-opus-4-7"
    And attribute "cost_usd" is "0.0875"
    And attribute "input_tokens" is "120"
    And attribute "output_tokens" is "30"
    And attribute "cache_read_tokens" is "58142"
    And attribute "cache_creation_tokens" is "1024"
    And attribute "session.id" is "sess_abc"
    When the receiver folds the log record into the trace summary
    Then the trace summary attributes contain "langwatch.model" with value "claude-opus-4-7"
    And the trace summary attributes contain "langwatch.cost.usd" with value "0.0875"
    And the trace summary attributes contain "langwatch.input_tokens" with value "120"
    And the trace summary attributes contain "langwatch.output_tokens" with value "30"
    And the trace summary attributes contain "langwatch.cache_read_tokens" with value "58142"
    And the trace summary attributes contain "langwatch.cache_creation_tokens" with value "1024"
    And the trace summary attributes contain "langwatch.thread.id" with value "sess_abc"

  Scenario: CodexExtractor lifts sse_event token counts onto canonical attributes
    Given a log record with event.name "codex.sse_event"
    And attribute "model" is "gpt-5.5"
    And attribute "input_token_count" is "9700"
    And attribute "output_token_count" is "15"
    And attribute "cached_token_count" is "8745"
    And attribute "conversation.id" is "conv_abc"
    And attribute "user.email" is "alex@acme.test"
    When the receiver folds the log record into the trace summary
    Then the trace summary attributes contain "langwatch.model" with value "gpt-5.5"
    And the trace summary attributes contain "langwatch.input_tokens" with value "9700"
    And the trace summary attributes contain "langwatch.output_tokens" with value "15"
    And the trace summary attributes contain "langwatch.cache_read_tokens" with value "8745"
    And the trace summary attributes contain "langwatch.thread.id" with value "conv_abc"
    And the trace summary attributes contain "langwatch.principal.email" with value "alex@acme.test"

  Scenario: GenAIExtractor lifts gen_ai.* canonical attributes off a gemini log record
    Given a log record carrying gen_ai.* attributes
    And attribute "gen_ai.request.model" is "gemini-2.0-flash"
    And attribute "gen_ai.usage.input_tokens" is "150"
    And attribute "gen_ai.usage.output_tokens" is "30"
    And attribute "gen_ai.conversation.id" is "conv_xyz"
    And attribute "cached_content_token_count" is "7"
    When the receiver folds the log record into the trace summary
    Then the trace summary attributes contain "langwatch.model" with value "gemini-2.0-flash"
    And the trace summary attributes contain "langwatch.input_tokens" with value "150"
    And the trace summary attributes contain "langwatch.output_tokens" with value "30"
    And the trace summary attributes contain "langwatch.cache_read_tokens" with value "7"
    And the trace summary attributes contain "langwatch.thread.id" with value "conv_xyz"

  Scenario: GenAIExtractor.applyLog activation is scope-agnostic
    Given a log record with scopeName "com.example.custom_emitter"
    And attribute "gen_ai.request.model" is "custom-model"
    When the receiver folds the log record into the trace summary
    Then the trace summary attributes contain "langwatch.model" with value "custom-model"

  Scenario: SpringAIExtractor lifts ChatModel observation bodies onto I/O attributes
    Given a log record with scopeName "org.springframework.ai.chat.observation.ChatModelPromptContentObservationHandler"
    And body "Chat Model Prompt Content:\nWhat is the capital of France?"
    When the receiver folds the log record into the trace summary
    Then the trace summary attributes contain "langwatch.input" with value "What is the capital of France?"

  Scenario: OTTL is the future-extensible catch-all on top of native lift
    Given an IngestionSource of sourceType "claude_code"
    And the source's parserConfig.ottlStatements is "set(attributes[\"langwatch.cost.center\"], \"acme-eng\")"
    When a claude_code.api_request log record arrives on the source
    Then the receiver runs the native ClaudeCodeExtractor first
    And the receiver then round-trips the payload through the OTTL transform
    And the trace summary attributes contain both the native lift AND the OTTL-derived "langwatch.cost.center"

  Scenario: An unknown wire scope falls through the registry without crashing
    Given a log record with scopeName "com.example.unknown_emitter"
    And no gen_ai.* attributes
    When the receiver folds the log record into the trace summary
    Then no canonical langwatch.* lift attributes are written
    And the trace summary still increments "langwatch.reserved.log_record_count"
