Feature: Ingest validation diagnostics

  When we reject a customer's trace or span for failing validation, the log has
  to answer one question: is the payload wrong, or is our schema too strict?

  Today it cannot. The rejection logs the whole request body and the whole span,
  which is customer content — prompts, completions, host identifiers — going to
  the log sink and to Sentry, and the same content is what makes the record too
  noisy to read. Meanwhile the thing an engineer actually needs, which field
  failed and what we demanded of it, is buried inside a serialised error.

  So the payload comes out and the shape goes in. Every rejection carries
  structured metadata naming the failing path, the rule that rejected it, and —
  for a field we did not expect — the key name we refused. Those are our own
  schema's terms, not the customer's data, so they are safe to log and safe to
  aggregate. A field name that shows up across many projects is the signal that
  we, not the sender, are the ones who need to change.

  Background:
    Given a project sending traces to the REST collector

  # ---------------------------------------------------------------------------
  # What the metadata says
  # ---------------------------------------------------------------------------

  @unit @regression
  Scenario: A rejected span reports the failing path and rule
    When a span fails schema validation
    Then the log carries one entry per validation issue
    And each entry names the path of the failing field
    And each entry names the validation rule that rejected it

  @unit @regression
  Scenario: A field we do not recognise is named
    When a span carries a field the schema does not allow
    Then the log names the rejected key
    And the issue is reported as an unrecognised key

  @unit @regression
  Scenario: A field of the wrong type reports both types by name
    When a span sends a field as the wrong type
    Then the log names the type the schema expected
    And the log names the type that arrived

  @unit @regression
  Scenario: Issue counts survive truncation
    Given a payload that fails validation in more ways than the log will carry
    Then the log carries the total number of issues
    And the entries it carries are marked as truncated

  # ---------------------------------------------------------------------------
  # What the metadata must never say
  #
  # The distinction is who authored the string. A path, a rule name and a
  # rejected key are our schema's vocabulary. A value is the customer's.
  # ---------------------------------------------------------------------------

  @unit @regression
  Scenario: Customer values never reach the log
    When a span fails validation on a field holding customer content
    Then the value of that field does not appear in the metadata

  @unit @regression
  Scenario: A rejected enum reports the options without the value
    When a field fails because its value is not one of the allowed options
    Then the log names the options the schema allows
    And the value that arrived does not appear in the metadata

  @unit @regression
  Scenario: The request body is not logged
    When a trace body fails schema validation
    Then the body does not appear in the log
    And the body does not appear in the error report sent to Sentry

  # ---------------------------------------------------------------------------
  # Level
  #
  # A validation failure is the sender's error, answered with a 400. It is
  # expected traffic, and it is watched by rate rather than by incident.
  # ---------------------------------------------------------------------------

  @unit @regression
  Scenario: A validation failure is a client error, not a server error
    When a span fails schema validation
    Then the rejection is logged at warning level
    And the response status is 400
