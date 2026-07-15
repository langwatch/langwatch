Feature: VS Code Copilot Chat OTLP spans canonicalize on the unified substrate
  ADR-039 §Extension #2. The VS Code Copilot Chat extension emits the same
  OTel GenAI-semantic-convention spans as the CLI and app (invoke_agent /
  chat / execute_tool) under `service.name` "copilot-chat", and posts them
  live to /api/otel authorized by a personal ingest key of sourceType
  "copilot_vscode". Receiver-side, the existing GenAI extractor already lifts
  the standard attributes — model, token usage, operation, captured content —
  with ZERO VS-Code-specific extractor code (empirically validated on VS Code
  1.128.1 / Copilot Chat 0.56.0: a real Chat turn landed with model, tokens,
  and content).

  Source separation: spans arrive under sourceType "copilot_vscode", stamped
  at the receiver edge, distinct from "copilot_cli" / "copilot_app". v1 is
  tokens-only: VS Code reports AI-units as `copilot_usage_nano_aiu` under
  obfuscated model codenames (e.g. `oswe-vscode-prime`), so dollar cost is out
  of scope. Spans land on the unified substrate per ADR-018 (project-scoped).

  Pairs with:
    - specs/ai-governance/ingestion-sources/copilot-cli-otlp.feature
    - specs/ai-governance/cli-wrappers/copilot-vscode-env.feature
    - dev/docs/adr/018-governance-unified-observability-substrate.md

  Background:
    Given an organization "acme" with a personal ingest key of sourceType "copilot_vscode"

  Rule: the standard GenAI attributes canonicalize without VS-Code-specific code

    @unit @unimplemented
    Scenario: A copilot-chat span yields model and token usage on the canonical trace
      Given a copilot-chat OTLP span named "chat" with gen_ai request model and token usage attributes
      When the span is ingested with the copilot_vscode ingest key
      Then the recorded span carries the model name
      And the recorded span carries input and output token counts

    @unit @unimplemented
    Scenario: Captured prompt content is lifted as span input
      Given a copilot-chat span whose attributes carry captured prompt content
      When the span is ingested with the copilot_vscode ingest key
      Then the recorded span's input carries the captured content

  Rule: VS Code spans are separated from other copilot surfaces by source

    @integration @unimplemented
    Scenario: VS Code spans are recorded under sourceType copilot_vscode
      Given a copilot-chat OTLP span
      When the span is ingested with the copilot_vscode ingest key
      Then the recorded span is stamped with sourceType "copilot_vscode"

    @integration @unimplemented
    Scenario: The source is stamped at the receiver, not taken from the payload
      Given a copilot-chat span whose payload claims sourceType "copilot_cli"
      When the span is ingested with the copilot_vscode ingest key
      Then the recorded span is stamped with sourceType "copilot_vscode"

  Rule: captured content is protected at the receiver

    @integration @unimplemented
    Scenario: PII in captured content is redacted before storage
      Given a copilot-chat span whose captured content contains an email address
      When the span is ingested with the copilot_vscode ingest key
      Then the stored content has the email address redacted

  Rule: v1 is tokens-only — no fabricated dollar cost

    @unit @unimplemented
    Scenario: A VS Code turn is recorded without a fabricated dollar cost
      Given a copilot-chat span carrying copilot_usage_nano_aiu under an obfuscated model codename
      When the span is ingested with the copilot_vscode ingest key
      Then the recorded span carries token counts
      And no dollar cost is fabricated for the unmapped model codename

  Rule: the VS Code path lands end-to-end

    @e2e @unimplemented
    Scenario: A real VS Code Chat turn appears in LangWatch with model, tokens, and content
      Given VS Code is connected via `langwatch code`
      When the user completes a Chat turn
      Then a "copilot_vscode" trace appears carrying the model, token counts, and captured content
