Feature: PII Redaction in Trace Processing

  Background:
    Given the trace processing pipeline is running

  @unit
  Scenario: Redacts PII from known attribute keys
    Given a span with attribute "gen_ai.prompt" containing "user@email.com"
    When the span is processed with PII redaction level "STRICT"
    Then the attribute value is redacted

  @unit
  Scenario: Skips redaction when globally disabled
    Given DISABLE_PII_REDACTION environment variable is set
    When a span is processed with any PII redaction level
    Then no redaction occurs

  @unit
  Scenario: Skips redaction when level is DISABLED
    Given a span with PII-bearing attributes
    When the span is processed with PII redaction level "DISABLED"
    Then no redaction occurs

  @unit
  Scenario: Only scans specific PII-bearing keys
    Given a span with attribute "other.attribute" containing PII
    When the span is processed with PII redaction level "STRICT"
    Then the attribute value is NOT redacted

  @unit
  Scenario: Does not mutate original command data
    Given a command with span data
    When the command is handled with PII redaction
    Then the original command data is unchanged
