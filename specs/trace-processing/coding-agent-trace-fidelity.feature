Feature: Coding Agent Trace Fidelity (Path B direct OTLP)

  Coding assistants (claude, codex, gemini, opencode) export OpenTelemetry
  straight to LangWatch on the direct-OTLP "Path B". This feature captures the
  fidelity guarantees for what lands on the trace: token accuracy, reasoning
  signals, tool calls, and how the bundled cost classification is surfaced.

  Background:
    Given the trace processing pipeline is running

  # --- Codex token accuracy -------------------------------------------------

  @unit
  Scenario: Codex turn tokens are counted once when two spans report the same usage
    Given a codex Path B turn where the turn rollup span and its response span both report the same token usage
    When the trace summary is computed
    Then the trace's input and output token totals count that usage once, not twice
    And the per-span detail still shows the usage on each span

  @unit
  Scenario: Codex reasoning output tokens are captured
    Given a codex Path B turn span reporting reasoning output tokens
    When the span is canonicalised
    Then the span carries the reasoning tokens under the canonical usage key
    And the trace summary reasoning token total includes them

  # --- Reasoning effort (the request setting, not the token count) -----------

  @unit
  Scenario: Codex reasoning effort is canonicalised from the turn span
    Given a codex Path B turn span reporting a reasoning effort setting
    When the span is canonicalised
    Then the span carries the reasoning effort under the canonical request key

  @unit
  Scenario: Reasoning effort is lifted onto the trace summary
    Given a trace whose model call span carries a reasoning effort setting
    When the trace summary is computed
    Then the trace summary attributes carry the reasoning effort
    And the drawer header reads it from the trace summary to show next to the model

  # --- Opencode tool calls --------------------------------------------------

  @unit
  Scenario: Opencode tool-call spans capture the tool name, arguments, and result
    Given an opencode Path B tool-call span reporting a tool name, arguments, and result
    When the span is canonicalised
    Then the span carries the tool name under the canonical tool name key
    And the tool arguments are captured as the span input
    And the tool result is captured as the span output

  # --- Bundled cost classification marker -----------------------------------

  @unit
  Scenario: The internal non-billable cost marker is hidden from the trace resources view
    Given a trace whose spans carry the internal non-billable cost resource marker
    When the trace resource attributes are read for the drawer
    Then the non-billable cost marker is not present in the returned resource attributes

  @unit
  Scenario: The bundled cost split is preserved when the non-billable marker is hidden
    Given a bundled coding-agent span priced from the model pricing tables
    When the trace summary is computed
    Then the bundled portion of the cost is recorded as non-billed cost
