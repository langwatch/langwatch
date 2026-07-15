Feature: `langwatch code` captures VS Code Copilot Chat via a scoped shell function
  ADR-039 §Extension #2. VS Code's built-in Copilot Chat extension emits
  standard OTel GenAI spans (invoke_agent / chat / execute_tool) and posts
  them to any OTLP endpoint given the env. VS Code is a CLI-launched editor
  (`code`), so it joins the SAME scoped-shell-function tier as
  copilot / gemini / opencode: `langwatch code` mints a personal ingest key
  for sourceType "copilot_vscode" and persists a scoped `code()` function
  that sets the telemetry env ONLY for `code` launches. The extension reads
  the window process env and posts authenticated `gen_ai.*` OTLP to
  /api/otel.

  The scoped-function env carries everything — enable, endpoint, Bearer, and
  content capture — so no VS Code settings.json edit is needed: the
  COPILOT_OTEL_ENABLED env overrides the extension's default-false
  `github.copilot.chat.otel.enabled` setting (spike-verified: an env-only
  launch with an empty settings.json still captured a real turn). VS Code is
  ingestion-only (direct OTLP); the chat extension has no gateway path. v1 is
  tokens-only: cost and AI-units are out of scope.

  Pairs with:
    - specs/ai-governance/cli-wrappers/shell-rc-persistence.feature
    - specs/ai-governance/cli-wrappers/cli-mints-ingest-key.feature
    - specs/ai-governance/ingestion-sources/copilot-vscode-otlp.feature

  Background:
    Given the user has completed `langwatch login --device` for org "acme"

  Rule: `langwatch code` resolves to ingestion (direct OTLP) only

    @unit
    Scenario: VS Code has no gateway path
      When the user runs `langwatch code`
      Then it resolves to ingestion mode (direct OTLP)
      And no gateway/BYOK env is injected

  Rule: the code env carries the full VS Code OTLP telemetry set

    @unit
    Scenario: The code env enables the extension's OTel and points it at LangWatch
      When `langwatch code` resolves to ingestion
      Then the code env sets COPILOT_OTEL_ENABLED to "true"
      And OTEL_EXPORTER_OTLP_ENDPOINT is the LangWatch /api/otel base
      And OTEL_EXPORTER_OTLP_HEADERS carries the personal ingest key as a Bearer

    @unit
    Scenario: The surface is labelled copilot-chat
      When `langwatch code` resolves to ingestion
      Then OTEL_RESOURCE_ATTRIBUTES sets service.name to "copilot-chat"

    @unit
    Scenario: Content capture is on by default
      When `langwatch code` resolves to ingestion
      Then the code env enables message-content capture

    @unit
    Scenario: An explicit opt-out yields a loud tokens-only notice, never silent
      Given the user opted out of content capture
      When `langwatch code` resolves to ingestion
      Then message-content capture is not enabled
      And the user is loudly notified that capture is tokens-only

  Rule: the token rides a scoped `code()` function, never a bare global export

    @unit @unimplemented
    Scenario: A scoped code() function sets the telemetry env only for code launches
      Given `langwatch code` resolves to ingestion
      When the user accepts the persistence prompt
      Then the shell rc gains a marker-bracketed `code()` function that sets the OTLP env then runs `command code`
      And the OTLP vars are NOT written as bare top-level exports

    @integration @unimplemented
    Scenario: A plain `code .` launch captures after persistence
      Given the scoped `code()` function is installed
      When the user launches `code .`
      Then VS Code Copilot Chat exports telemetry to LangWatch
      And other shell children do not inherit the OTLP env

  Rule: the VS Code key is distinct and minted for copilot_vscode

    @integration
    Scenario: `langwatch code` mints a copilot_vscode ingest key
      When `langwatch code` resolves to ingestion for the first time
      Then a personal ingest key of sourceType "copilot_vscode" is minted for org "acme"

    @integration @unimplemented
    Scenario: The VS Code key is separate from the copilot_cli key
      Given the user already has a personal ingest key of sourceType "copilot_cli"
      When `langwatch code` mints its key
      Then the "copilot_vscode" key is a different key from the "copilot_cli" key

  Rule: logout removes the VS Code capture

    @integration @unimplemented
    Scenario: Logout removes the scoped code() function
      Given the scoped `code()` function is installed
      When the user runs `langwatch logout`
      Then the `code()` function is removed from the shell rc

    @integration @unimplemented
    Scenario: Logout revokes the copilot_vscode key
      When the user runs `langwatch logout`
      Then the personal ingest key of sourceType "copilot_vscode" is revoked
