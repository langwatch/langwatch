@unimplemented
Feature: Langy agent activity is traced into the user's project
  As a LangWatch user running Langy
  I want Langy's agent activity (reasoning, LLM calls, MCP tool calls) captured as traces
  So that I can observe and debug what Langy did, in my own project, tagged "langy"

  # Part of epic #4528 (issue #4536).
  #
  # The Langy worker spawns one `opencode serve` subprocess per conversation
  # (services/langy-agent/server.js). opencode has NO native OpenTelemetry
  # export, so an opencode telemetry plugin (@devtheops/opencode-plugin-otel,
  # pinned) emits session/llm/tool spans over OTLP http/protobuf, authenticated
  # with the project's dedicated Langy API key, into LangWatch's existing
  # ingest endpoint POST /api/otel/v1/traces. No new REST endpoints.
  #
  # The plugin tags traces via OTLP *resource* attributes. LangWatch already
  # maps reserved keys (tag.tags -> labels, langwatch.thread.id -> thread_id)
  # from *span* attributes; this feature also maps them from resource
  # attributes so the "langy" label and conversation grouping survive.

  Background:
    Given a project with a provisioned dedicated Langy API key
    And the Langy worker is configured with the opencode OTel plugin

  # ============================================================================
  # End-to-end: a Langy chat becomes a labeled trace
  # ============================================================================

  Scenario: A Langy chat produces a trace in the user's project
    When I send a message to Langy in my project
    Then a trace appears in that same project
    And the trace's labels contain "langy"

  Scenario: The trace captures the agent's activity as spans
    When Langy answers using an LLM and at least one MCP tool
    Then the trace contains a span for the LLM call
    And the trace contains a span for the MCP tool call

  Scenario: Turns of one conversation are grouped together
    Given a Langy conversation with id "conv-123"
    When I send two messages in that conversation
    Then both resulting traces share thread_id "conv-123"

  # ============================================================================
  # OTLP export wiring (services/langy-agent)
  # ============================================================================

  Scenario: The worker exports over a protocol LangWatch accepts
    Given the worker spawns an opencode subprocess for a conversation
    Then the subprocess environment enables the OTel plugin
    And the OTLP endpoint resolves to "<LANGWATCH_ENDPOINT>/api/otel/v1/traces"
    And the OTLP protocol is "http/protobuf"
    And the OTLP headers authenticate with the dedicated Langy API key as a Bearer token
    And the OTLP resource attributes include "tag.tags=langy" and the conversation id

  Scenario: opencode without the plugin exports nothing
    # Guards against the silent no-op: standard OTEL_* env on opencode is ignored.
    Given an opencode subprocess without the OTel plugin enabled
    When it runs a turn
    Then no traces are exported

  # ============================================================================
  # Ingestion: reserved metadata keys in OTLP resource attributes
  # Covered by src/server/tracer/__tests__/metadataLabels.integration.test.ts
  # ============================================================================

  Scenario: tag.tags in resource attributes becomes trace labels
    Given an OTLP trace whose resource attributes include "tag.tags=langy"
    When the trace is ingested at /api/otel/v1/traces
    Then the stored trace's labels contain "langy"

  Scenario: langwatch.thread.id in resource attributes becomes thread_id
    Given an OTLP trace whose resource attributes include "langwatch.thread.id=conv-123"
    When the trace is ingested
    Then the stored trace's thread_id is "conv-123"

  Scenario: Non-reserved resource attributes stay as custom metadata
    Given an OTLP trace whose resource attributes include "service.name=langy-agent"
    When the trace is ingested
    Then "service.name" is preserved in the trace's custom metadata
    And it is not promoted to a reserved field
