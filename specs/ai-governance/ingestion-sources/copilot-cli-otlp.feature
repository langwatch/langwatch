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
      Given a copilot OTLP span for the "chat" gen_ai operation with request model and token usage attributes
      When the span is ingested with the copilot_cli ingest key
      Then the recorded span carries the model name
      And the recorded span carries input and output token counts

    @unit
    Scenario: A copilot tool-execution span canonicalizes as a tool span
      Given a copilot OTLP span for the "execute_tool" gen_ai operation with tool attributes
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
    Scenario: Copilot turn tokens are counted once across the agent rollup and its chat span
      Given a copilot turn whose invoke_agent root span repeats its chat child's token usage
      When both spans are canonicalized and folded into the trace summary
      Then the trace totals count the turn's tokens exactly once

    @unit
    Scenario: Captured content payloads survive canonicalisation as span input and output
      Given a copilot span whose attributes carry captured prompt and response content
      When the canonicalisation chain runs
      Then the canonical span's input and output carry the captured content unmodified

    @unit
    Scenario: A span without gen_ai attributes is left untouched by the copilot extractor
      Given an OTLP span with no gen_ai or github copilot attributes
      When the canonicalisation chain runs
      Then the copilot extractor lifts nothing from it

  Rule: spans captured from real Copilot builds canonicalize as the documented shape does
    The fixtures are redacted captures from Copilot CLI 1.0.79 and 1.0.100 and
    VS Code Copilot Chat 0.67, each recording its vendor version (#8803).

    @unit
    Scenario: A captured Copilot CLI chat span carries model, tokens and the session key
      Given a redacted chat span captured from Copilot CLI
      When the canonicalisation chain runs
      Then the canonical span carries the model, the token counts and the conversation id
      And the AI-unit count is recorded as metadata, never as a dollar cost

    @unit
    Scenario: A captured Copilot CLI agent rollup is not counted on top of its chat spans
      Given a redacted invoke_agent span captured from Copilot CLI
      When the canonicalisation chain runs
      Then the span is flagged to skip token accumulation

    @unit
    Scenario: Repository context is lifted only from Copilot builds that send it
      Given a redacted invoke_agent span from Copilot CLI 1.0.79, which sends git attributes
      And a redacted invoke_agent span from Copilot CLI 1.0.100, which sends none
      When the canonicalisation chain runs on each
      Then the first carries the repository and organization as metadata
      And the second carries no repository

    @unit
    Scenario: A captured VS Code agent rollup keeps the repository as the remote URL it was sent as
      Given a redacted invoke_agent span captured from VS Code Copilot Chat
      When the canonicalisation chain runs
      Then the canonical span carries the repository remote URL as metadata

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
