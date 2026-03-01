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

  @unit
  Scenario: Marks span with "partial" status when some attributes exceed size
    Given a span with one oversized and one normal PII-bearing attribute
    When the span is processed with PII redaction level "STRICT"
    Then the span has attribute "langwatch.reserved.pii_redaction_status" set to "partial"
    And the normal attribute is redacted
    And the oversized attribute is left unmodified

  @unit
  Scenario: Marks span with "none" status when all attributes exceed size
    Given a span where all PII-bearing attributes exceed the max PII redaction length
    When the span is processed with PII redaction level "STRICT"
    Then the span has attribute "langwatch.reserved.pii_redaction_status" set to "none"

  @unit
  Scenario: Does not mark span when all attributes are within size
    Given a span with attribute "gen_ai.prompt" within the max PII redaction length
    When the span is processed with PII redaction level "STRICT"
    Then the span does NOT have attribute "langwatch.reserved.pii_redaction_status"

  @unit
  Scenario: Strips user-submitted langwatch.reserved.* attributes from spans
    Given a span with user-submitted attribute "langwatch.reserved.pii_redaction_status"
    When the span is recorded
    Then the attribute is stripped before processing
    And an error is logged

  @unit
  Scenario: Trace summary separates partial and fully-skipped span IDs
    Given a trace with spans where:
      | span    | pii_redaction_status |
      | span-1  | partial              |
      | span-2  | none                 |
      | span-3  | (not set)            |
    When the trace summary is computed
    Then the trace summary attributes contain:
      | attribute key                                        | span IDs  |
      | langwatch.reserved.pii_redaction_partial_span_ids    | ["span-1"] |
      | langwatch.reserved.pii_redaction_skipped_span_ids    | ["span-2"] |
