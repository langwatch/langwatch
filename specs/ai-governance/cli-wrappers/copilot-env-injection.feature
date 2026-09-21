Feature: `langwatch copilot` injects the right env for each path
  ADR-039 Decisions 2, 4, 5. Copilot CLI (>= 1.0.41) is instrumented purely
  through environment:

    - Path A (gateway): Copilot's BYOK env vars point its LLM traffic at the
      LangWatch gateway speaking the OpenAI-compatible wire format, with the
      user's personal virtual key as the API key.
    - Path B (direct OTLP): Copilot's native OTel export is enabled and
      pointed at LangWatch, authorized by a personal ingest key minted for
      sourceType "copilot_cli" (distinct from the existing "copilot_studio"
      audit-feed source).

  Capture-everything default (ADR-039 constraint): content capture is on by
  default via the standard OTel GenAI env var
  (OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT — spike-verified
  against the copilot 1.0.69 binary, no config write needed). An explicit
  user opt-out is respected with a loud tokens-only notice; never silently
  tokens-only.

  Pairs with:
    - specs/ai-governance/cli-wrappers/cli-mints-ingest-key.feature
    - specs/ai-governance/cli-wrappers/wrap-login-routing.feature

  Background:
    Given the user has completed `langwatch login --device` for org "acme"

  Rule: Path A injects the BYOK gateway env

    @unit
    Scenario: Gateway mode points copilot's BYOK provider at the LangWatch gateway
      Given tool_mode.copilot is saved as "gateway"
      And the user has a personal virtual key
      When the user runs `langwatch copilot`
      Then the child env sets COPILOT_PROVIDER_TYPE to "openai"
      And COPILOT_PROVIDER_BASE_URL is the gateway URL
      And COPILOT_PROVIDER_API_KEY is the personal virtual key

    @unit
    Scenario: Gateway mode does not enable copilot's own OTel export
      Given tool_mode.copilot is saved as "gateway"
      And the user has a personal virtual key
      When the user runs `langwatch copilot`
      Then the child env does not set COPILOT_OTEL_ENABLED
      And no OTEL_EXPORTER_OTLP_ENDPOINT is injected

    @unit
    Scenario: Copilot's provider families accept either an OpenAI or Anthropic upstream
      Given the org has only an Anthropic provider credential configured
      When the gateway preflight for "copilot" checks provider families
      Then the preflight passes

  Rule: Path B enables copilot's native OTel export against LangWatch

    @unit
    Scenario: Ingestion mode mints a copilot_cli ingest key and enables native OTel
      Given tool_mode.copilot is saved as "ingestion"
      And no cached ingest key exists for "copilot_cli"
      When the user runs `langwatch copilot`
      Then an ingest key is minted with sourceType "copilot_cli"
      And the child env sets COPILOT_OTEL_ENABLED to "true"
      And OTEL_EXPORTER_OTLP_ENDPOINT points at the LangWatch OTLP endpoint
      And OTEL_EXPORTER_OTLP_HEADERS carries the ingest key as a Bearer token
      And OTEL_EXPORTER_OTLP_PROTOCOL is "http/json"

    @unit
    Scenario: Ingestion mode pins the OTLP exporter type against an inherited file exporter
      Given tool_mode.copilot is saved as "ingestion"
      And the parent shell exports COPILOT_OTEL_EXPORTER_TYPE=file
      When the user runs `langwatch copilot`
      Then the child env's COPILOT_OTEL_EXPORTER_TYPE is the OTLP exporter value
      And telemetry is not redirected to a local file

    @unit
    Scenario: A cached copilot_cli ingest key is reused instead of re-minting
      Given tool_mode.copilot is saved as "ingestion"
      And a cached ingest key exists for "copilot_cli" and is still live on the platform
      When the user runs `langwatch copilot`
      Then no new ingest key is minted

  Rule: content capture degrades loudly, never silently

    @unit
    Scenario: Content capture is enabled by default in ingestion mode
      Given tool_mode.copilot is saved as "ingestion"
      When the user runs `langwatch copilot`
      Then copilot's content capture setting is enabled for the child

    @unit
    Scenario: An explicit user opt-out of content capture is never overwritten
      Given the user's copilot config explicitly disables content capture
      When the user runs `langwatch copilot` in ingestion mode
      Then the user's content capture setting is left as disabled
      And the wrapper warns that traces will carry tokens only
