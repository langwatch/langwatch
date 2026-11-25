Feature: An ingestion key refused for its permission ceiling is logged as a customer fault, sampled per key
  A key that lacks traces:create is refused with a 403 the sender can act on
  (specs/traces/trace-ingestion-door.feature). The refusal is the customer's
  configuration, not a platform incident, so it is logged as a warning. One
  misconfigured exporter retries the same refused batch many times a second;
  the log keeps one line per key per window and counts the refusals it held back.

  @unit
  Scenario: A ceiling refusal is logged as a warning, not an error
    Given an API key without the traces:create permission
    When it sends a trace batch
    Then the batch is refused with the permission-denied error
    And the refusal is logged once as a warning
    And nothing is logged as an error

  @unit
  Scenario: Repeated refusals for one key inside the window log a single line
    Given an API key without the traces:create permission
    When it sends five trace batches inside one sampling window
    Then every batch is refused
    And only the first refusal is logged

  @unit
  Scenario: The next line after the window carries the count of refusals held back
    Given an API key that was refused four more times after its logged refusal
    When the sampling window has passed and it is refused again
    Then the refusal is logged with four suppressed refusals

  @unit
  Scenario: Refusals for different keys are sampled independently
    Given two API keys without the traces:create permission
    When each sends a trace batch inside one sampling window
    Then each key's first refusal is logged
