Feature: Simulation runs list API message truncation
  As an API consumer listing simulation runs
  I want to know when a run's messages were trimmed and to be able to ask for all of them
  So that a long conversation is never silently cut short in my export or report

  # The set-level and all-suites list queries read a trimmed projection (first
  # 6 messages, no reasoning or error payloads) to protect ClickHouse. That
  # stays the default; what changes is that the trim is visible in the
  # response, and a caller can opt into the full conversation with
  # include=messages. Asking for full messages caps the page size, because the
  # heavy columns are what the trim exists to avoid reading in bulk.

  Background:
    Given I am authenticated with a project API key

  @integration
  Scenario: A set-level list marks a run whose messages were trimmed
    Given a run in a set holds more than 6 messages
    When the caller lists the set's runs
    Then that run carries 6 messages and messagesTruncated true

  @integration
  Scenario: A run within the message limit is not marked as truncated
    Given a run in a set holds 6 or fewer messages
    When the caller lists the set's runs
    Then that run carries all its messages and messagesTruncated false

  @integration
  Scenario: include=messages returns every message on a set-level list
    Given a run in a set holds more than 6 messages
    When the caller lists the set's runs with include=messages
    Then that run carries all its messages
    And messagesTruncated is false

  @unit
  Scenario: include=messages caps the page size
    Given a caller asks for 100 runs with include=messages
    When the list is served
    Then the page size is reduced to the full-message cap

  @unit
  Scenario: include=messages stops the page at the batch that would pass the run cap
    Given the selected batches together hold more runs than the full-message cap
    When the page is built
    Then the page ends at the last batch that fits within the cap
    And the next cursor points at that batch so no run is skipped

  @unit
  Scenario: A single batch larger than the run cap is still served whole
    Given the first selected batch alone holds more runs than the full-message cap
    When the page is built
    Then every run of that batch is returned

  @integration
  Scenario: A batch-scoped list is unchanged by the include parameter
    Given a run in a batch holds more than 6 messages
    When the caller lists the batch's runs
    Then that run carries all its messages
