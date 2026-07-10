Feature: Copilot CLI OTLP spans canonicalize on the unified substrate
  ADR-039 Decision 6. Copilot CLI (>= 1.0.41) emits OpenTelemetry
  GenAI-semantic-convention spans (invoke_agent / chat / execute_tool) with
  standard gen_ai.* attributes, plus Copilot-specific extras. Receiver-side:

    - The existing GenAI extractor in the canonicalisation chain already
      lifts the standard attributes (model, token usage, operation) — zero
      copilot-specific code for the semconv core.
    - A thin copilot extractor, registered after the GenAI extractor, lifts
      only the Copilot extras: premium-request consumption, repository/org
      context, the hashed end-user id, and captured content payloads. It
      reuses shared extraction primitives and never re-reads attributes the
      GenAI extractor already consumed.

  Spans arrive through the personal-ingest-key path with sourceType
  "copilot_cli" and land on the unified substrate per ADR-018 (origin
  metadata stamped at the receiver edge, project-scoped).

  Pairs with:
    - specs/ai-governance/ingestion-sources/claude-code-otlp.feature
    - dev/docs/adr/018-governance-unified-observability-substrate.md

  Background:
    Given an organization "acme" with a personal ingest key of sourceType "copilot_cli"

  Rule: the standard GenAI attributes canonicalize without copilot-specific code

    @unit
    Scenario: A copilot chat span yields model and token usage on the canonical trace
      Given a copilot OTLP span named "chat" with gen_ai request model and token usage attributes
      When the span is ingested with the copilot_cli ingest key
      Then the recorded span carries the model name
      And the recorded span carries input and output token counts

    @unit
    Scenario: A copilot tool-execution span canonicalizes as a tool span
      Given a copilot OTLP span named "execute_tool" with gen_ai tool attributes
      When the span is ingested with the copilot_cli ingest key
      Then the recorded span's type reflects a tool execution

  Rule: the copilot extractor lifts only the Copilot-specific extras

    @unit
    Scenario: Repository and organization context are lifted onto the canonical span
      Given a copilot span carrying github repository and organization attributes
      When the canonicalisation chain runs
      Then the canonical span carries the repository and organization as metadata

    @unit
    Scenario: Premium request consumption is lifted onto the canonical span
      Given a copilot span carrying a premium-request consumption attribute
      When the canonicalisation chain runs
      Then the canonical span records the premium-request consumption

    @unit
    Scenario: Captured content payloads are lifted as span input and output
      Given a copilot span whose attributes carry captured prompt and response content
      When the canonicalisation chain runs
      Then the canonical span's input and output carry the captured content

    @unit
    Scenario: A span without gen_ai attributes is left untouched by the copilot extractor
      Given an OTLP span with no gen_ai or github copilot attributes
      When the canonicalisation chain runs
      Then the copilot extractor lifts nothing from it

  Rule: oversized copilot content cannot destabilize the pipeline

    @unit
    Scenario: An oversized content value on a span event is capped at ingestion
      Given a copilot span event carrying a content attribute larger than the per-value cap
      When the span is ingested with the copilot_cli ingest key
      Then the stored attribute value is truncated to the cap
      And the span is otherwise recorded intact

    @unit
    Scenario: A long session of content-carrying spans ingests without unbounded accumulation
      Given a session of one hundred copilot spans each carrying captured content
      When all spans are ingested with the copilot_cli ingest key
      Then every span is recorded
      And the trace-level accumulated payload respects the pipeline's size guards
