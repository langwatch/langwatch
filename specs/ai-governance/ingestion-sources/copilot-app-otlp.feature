Feature: Copilot app OTLP spans canonicalize on the unified substrate
  ADR-039 §Extension. The standalone GitHub Copilot app emits the same OTel
  GenAI-semantic-convention spans as the CLI (invoke_agent / chat /
  execute_tool) with standard gen_ai.* attributes, plus Copilot-specific
  extras, and pushes them live to /api/otel authorized by a personal ingest
  key of sourceType "copilot_app". Receiver-side:

    - The existing GenAI extractor already lifts the standard attributes
      (model, token usage, operation) — zero copilot-specific code for the
      semconv core.
    - The shared copilot extractor lifts the Copilot extras: the hashed
      end-user id and captured content payloads. The only extension for the
      app is the raw AI-unit cost (github.copilot.nano_aiu).

  Source separation: app spans arrive under sourceType "copilot_app", stamped
  at the receiver edge, distinct from the CLI's "copilot_cli" — the two
  surfaces are separated by source, not transport, so there is no
  double-capture even though both push OTLP to the same /api/otel.

  Content protection: captured prompts and responses pass the ESSENTIAL
  server-side PII redaction on /api/otel; oversized attributes are capped by
  capOversizedAttributes, not dropped. Spans land on the unified substrate
  per ADR-018 (project-scoped).

  Pairs with:
    - specs/ai-governance/ingestion-sources/copilot-cli-otlp.feature
    - specs/ai-governance/cli-wrappers/copilot-app-launch-agent.feature
    - dev/docs/adr/018-governance-unified-observability-substrate.md

  Background:
    Given an organization "acme" with a personal ingest key of sourceType "copilot_app"

  Rule: the standard GenAI attributes canonicalize without copilot-specific code

    @unit @unimplemented
    Scenario: An app chat span yields model and token usage on the canonical trace
      Given a copilot OTLP span named "chat" with gen_ai request model and token usage attributes
      When the span is ingested with the copilot_app ingest key
      Then the recorded span carries the model name
      And the recorded span carries input and output token counts

    @unit
    Scenario: An app tool-execution span canonicalizes as a tool span
      Given a copilot OTLP span named "execute_tool" with gen_ai tool attributes
      When the span is ingested with the copilot_app ingest key
      Then the recorded span's type reflects a tool execution

  Rule: the copilot extractor lifts the app-specific extras

    @unit
    Scenario: Raw AI-unit cost is lifted onto the canonical span
      Given a copilot span carrying a github.copilot.nano_aiu attribute
      When the canonicalisation chain runs
      Then the canonical span records the raw AI-unit cost

    @unit @unimplemented
    Scenario: The hashed end-user id is lifted as user metadata
      Given a copilot span carrying a hashed enduser.pseudo.id attribute
      When the canonicalisation chain runs
      Then the canonical span carries the hashed end-user id as metadata

    @unit @unimplemented
    Scenario: Captured content payloads are lifted as span input and output
      Given a copilot span whose attributes carry captured prompt and response content
      When the canonicalisation chain runs
      Then the canonical span's input and output carry the captured content

  Rule: app spans are separated from CLI spans by source

    @integration @unimplemented
    Scenario: App spans are recorded under sourceType copilot_app
      Given a copilot OTLP span
      When the span is ingested with the copilot_app ingest key
      Then the recorded span is stamped with sourceType "copilot_app"

    @integration @unimplemented
    Scenario: The copilot_app source is stamped at the receiver, not taken from the payload
      Given a copilot OTLP span whose payload claims sourceType "copilot_cli"
      When the span is ingested with the copilot_app ingest key
      Then the recorded span is stamped with sourceType "copilot_app"

  Rule: captured content is protected at the receiver

    @integration @unimplemented
    Scenario: PII in captured content is redacted before storage
      Given a copilot span whose captured content contains an email address
      When the span is ingested with the copilot_app ingest key
      Then the stored content has the email address redacted

    @integration @unimplemented
    Scenario: An oversized content payload is capped, not dropped
      Given a copilot span whose captured content exceeds the attribute size cap
      When the span is ingested with the copilot_app ingest key
      Then the span is recorded with the content capped rather than the span dropped

  Rule: the app path lands end-to-end

    @e2e @unimplemented
    Scenario: A real app turn appears in LangWatch with model, tokens, cost, and content
      Given the Copilot app is connected and captured
      When the user completes a turn in the app
      Then a "copilot_app" trace appears carrying the model, token counts, AI-unit cost, and captured content
