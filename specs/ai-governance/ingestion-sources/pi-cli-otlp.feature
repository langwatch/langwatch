# pi CLI OTLP spans, canonicalised by the generic chain plus one thin extractor
#
# Implementation:
#   packages/span-normalisation/src/genAiCanonicaliser.ts     (the generic lift pi's dual write relies on)
#   packages/span-normalisation/src/spanCanonicalisation.ts   (the ordered chain, where a pi extractor registers)
#   packages/span-normalisation/src/copilotCanonicaliser.ts   (the thin per-tool extractor a pi one follows)
#   packages/span-normalisation/src/canonicalExtraction.ts    (the shared extraction primitives)
#   packages/span-normalisation/src/tracePayloadCap.ts        (the per-value and per-trace content caps)
#   enterprise/modules/governance/contract/src/features/ingestion/ingestion-source-key.commands.ts (the sourceType a key is minted for)
#   enterprise/modules/governance/contract/src/features/ingestion/otlp-receiver-policy.ts (what an ingest key may stamp)
#
# Related specs:
#   specs/ai-governance/ingestion-sources/native-receiver-lift.feature, the generic GenAI lift
#   specs/ai-governance/ingestion-sources/copilot-cli-otlp.feature    , the same shape for Copilot
#   specs/coding-agent/pi-model-calls.feature                         , what the lifted figures are used for
#   specs/coding-agent/pi-sessions.feature                            , the session the spans fold into
#   specs/ai-governance/cli-wrappers/pi-env-injection.feature         , how the spans are addressed at us
#   dev/docs/adr/018-governance-unified-observability-substrate.md
#
# Motivation: pi dual-writes every model-call attribute, pi's own key beside the
# GenAI convention key. That is what lets the chain price and fold pi with no
# pi-shaped branch: the existing GenAI canonicaliser lifts model, operation and
# token usage on its own.
#
# A thin pi extractor registers after it and lifts only what the conventions
# have no name for: cache-write and reasoning tokens, pi's reported cost under
# pi's own key rather than as the charge, its stop reason and error type, and
# the session, turn and tool identifiers its harness spans carry. It reuses the shared extraction primitives and never
# re-reads an attribute the GenAI canonicaliser already consumed, because
# reading a figure twice is how a token count ends up doubled.
#
# The canonicalisation scenarios are bound by
# packages/span-normalisation/src/__tests__/piCanonicaliser.unit.test.ts, which
# runs the whole ordered chain exactly as ingestion does.
#
# The origin-stamping scenarios are bound by
# enterprise/modules/governance/contract/src/__tests__/otlp-receiver-policy.unit.test.ts,
# which lists pi_cli among CODING_AGENT_SOURCES.
#
# WHAT IS STILL @unimplemented, AND WHY, AS OF 2026-10-30:
#   THE PAYLOAD-CAP SCENARIOS. capPayloadString already bounds any oversized
#   value, but nothing applies it per ingest source, so there is no
#   pi-specific behaviour to assert and no receiver test to assert it in.
#
# A scenario still carrying @unimplemented when ADR-188 is called done is work
# that was not done.

Feature: pi CLI OTLP spans canonicalise on the unified substrate
  Spans arrive through the personal-ingest-key path with sourceType "pi_cli"
  and land on the unified substrate per ADR-018, with origin metadata stamped
  at the receiver edge and project-scoped.

  Background:
    Given an organisation "acme" with a personal ingest key of sourceType "pi_cli"

  Rule: the dual-written GenAI attributes canonicalise without pi-specific code

    @unit
    Scenario: A pi model-call span yields model and token usage on the canonical trace
      Given a span named "pi.ai.request"
      And attribute "gen_ai.request.model" is "claude-opus-4-7"
      And attribute "gen_ai.usage.input_tokens" is "120"
      And attribute "gen_ai.usage.output_tokens" is "30"
      When the canonicalisation chain runs
      Then the recorded span attributes contain:
        | attribute                  | value           |
        | gen_ai.request.model       | claude-opus-4-7 |
        | gen_ai.usage.input_tokens  | 120             |
        | gen_ai.usage.output_tokens | 30              |
      And the span is typed as a model call

    @unit
    Scenario: A pi tool span canonicalises as a tool span
      Given a span named "pi.harness.tool"
      And attribute "pi.tool.name" is "bash"
      When the canonicalisation chain runs
      Then the recorded span's type reflects a tool execution
      And it keeps the tool name "bash"

  Rule: the pi extractor lifts only what the conventions cannot name

    @unit
    Scenario: Cache-write and reasoning tokens are lifted as their own token types
      Given a pi.ai.request span reporting cache-write and reasoning tokens
      When the canonicalisation chain runs
      Then the canonical span records each as its own token type
      And neither is added into the output token count

    @unit
    Scenario: pi's reported cost survives beside the computed cost, never as it
      Given a span named "pi.ai.request"
      And attribute "pi.ai.usage.cost" is "0.0875"
      When the canonicalisation chain runs
      Then the canonical span still carries "pi.ai.usage.cost" with value "0.0875"
      And no canonical cost attribute is set from that figure

    @unit
    Scenario: pi's stop reason and error type are lifted onto the canonical span
      Given a pi.ai.request span that ended with a stop reason and an error type
      When the canonicalisation chain runs
      Then the canonical span carries both as pi reported them

    @unit
    Scenario: Session, turn and tool identifiers are lifted from pi's harness spans
      Given the run, turn and tool spans of one pi session
      And the run carries attribute "pi.session.id" "s-1"
      When the canonicalisation chain runs
      Then the recorded span attributes contain:
        | attribute           | value |
        | langwatch.thread.id | s-1   |
      And the turn and tool spans keep pi's turn and tool-call identifiers

    @unit
    Scenario: A span with neither pi nor gen_ai attributes is left untouched
      Given an OTLP span in an unrelated namespace
      When the canonicalisation chain runs
      Then the pi extractor lifts nothing from it

  Rule: pi spans are stamped with the coding-agent origin at the edge

    @unit
    Scenario: A pi span ingested under its own key carries the coding-agent origin
      Given a pi.harness.run span
      When the span is ingested with the pi_cli ingest key
      Then the recorded span carries the coding-agent origin
      And it carries the organisation and source as resource attributes

    @unit
    Scenario: pi spans sent with another source's key do not pass as pi's
      Given a pi.harness.run span
      When the span is ingested with an unrelated source's ingest key
      Then it is not stamped with the pi source

  Rule: oversized pi content cannot destabilise the pipeline

    # becomes @unit
    @unimplemented
    Scenario: An oversized prompt or tool output on a pi span is capped at ingestion
      Given a pi.harness.tool span carrying a content attribute larger than the per-value cap
      When the span is ingested with the pi_cli ingest key
      Then the stored attribute value is truncated to the cap
      And the span is otherwise recorded intact

    # becomes @unit
    @unimplemented
    Scenario: A long pi session of content-carrying spans ingests without unbounded accumulation
      Given a session of one hundred pi spans each carrying captured content
      When all spans are ingested with the pi_cli ingest key
      Then every span is recorded
      And the trace-level accumulated payload respects the pipeline's size guards
