Feature: pi CLI OTLP spans canonicalize on the unified substrate
  ADR-188 Decisions 5, 6 and 7. pi's spans arrive in pi's own declared
  namespace, with every model-call attribute dual-written in GenAI semantic
  conventions. Receiver-side:

    - The existing GenAI extractor in the canonicalisation chain lifts the
      standard attributes of a `pi.ai.request` span (model, operation, input
      and output tokens) with no pi-specific code.
    - A thin pi extractor, registered after the GenAI extractor, lifts only
      what the conventions have no name for: cache-write and reasoning
      tokens, pi's reported cost, its stop reason and error type, and the
      session, turn and tool identifiers its harness spans carry. It reuses
      the shared extraction primitives and never re-reads attributes the
      GenAI extractor already consumed.

  Spans arrive through the personal-ingest-key path with sourceType "pi_cli"
  and land on the unified substrate per ADR-018, with origin metadata stamped
  at the receiver edge and project-scoped.

  Pairs with:
    - specs/ai-governance/ingestion-sources/copilot-cli-otlp.feature
    - specs/coding-agent/pi-model-calls.feature
    - dev/docs/adr/018-governance-unified-observability-substrate.md

  Background:
    Given an organization "acme" with a personal ingest key of sourceType "pi_cli"

  Rule: the dual-written GenAI attributes canonicalize without pi-specific code

    @unit
    Scenario: A pi model-call span yields model and token usage on the canonical trace
      Given a pi.ai.request span carrying the dual-written GenAI model and token attributes
      When the span is ingested with the pi_cli ingest key
      Then the recorded span carries the model name
      And the recorded span carries input and output token counts

    @unit
    Scenario: A pi tool span canonicalizes as a tool span
      Given a pi.harness.tool span carrying pi's tool name
      When the span is ingested with the pi_cli ingest key
      Then the recorded span's type reflects a tool execution
      And it keeps pi's tool name

  Rule: the pi extractor lifts only what the conventions cannot name

    @unit
    Scenario: Cache-write and reasoning tokens are lifted as their own token types
      Given a pi.ai.request span reporting cache-write and reasoning tokens
      When the canonicalisation chain runs
      Then the canonical span records each as its own token type

    @unit
    Scenario: pi's reported cost is lifted as a reported figure, not recomputed
      Given a pi.ai.request span carrying pi's reported cost
      When the canonicalisation chain runs
      Then the canonical span records the cost as reported by pi

    @unit
    Scenario: pi's stop reason and error type are lifted onto the canonical span
      Given a pi.ai.request span that ended with a stop reason and an error type
      When the canonicalisation chain runs
      Then the canonical span carries both as pi reported them

    @unit
    Scenario: Session, turn and tool identifiers are lifted from pi's harness spans
      Given the run, turn and tool spans of one pi session
      When the canonicalisation chain runs
      Then the canonical spans carry pi's session, turn and tool-call identifiers

    @unit
    Scenario: A span with neither pi nor gen_ai attributes is left untouched
      Given an OTLP span in an unrelated namespace
      When the canonicalisation chain runs
      Then the pi extractor lifts nothing from it

    @unit
    Scenario: pi session tokens are counted once across the run and its model calls
      Given a pi run span whose usage repeats its two model calls' usage
      When all spans are canonicalized and folded into the trace summary
      Then the trace totals count the session's tokens exactly once

  Rule: pi spans are stamped with the coding-agent origin at the edge

    @unit
    Scenario: A pi span ingested under its own key carries the coding-agent origin
      Given a pi.harness.run span
      When the span is ingested with the pi_cli ingest key
      Then the recorded span carries the coding-agent origin
      And it carries the organization and source as resource attributes

    @unit
    Scenario: pi spans sent with another source's key do not pass as pi's
      Given a pi.harness.run span
      When the span is ingested with an unrelated source's ingest key
      Then it is not stamped with the pi source

  Rule: oversized pi content cannot destabilize the pipeline

    @unit
    Scenario: An oversized content value on a pi span is capped at ingestion
      Given a pi span carrying a content attribute larger than the per-value cap
      When the span is ingested with the pi_cli ingest key
      Then the stored attribute value is truncated to the cap
      And the span is otherwise recorded intact

    @unit
    Scenario: A long pi session ingests without unbounded accumulation
      Given a session of one hundred pi spans each carrying captured content
      When all spans are ingested with the pi_cli ingest key
      Then every span is recorded
      And the trace-level accumulated payload respects the pipeline's size guards
