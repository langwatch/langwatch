Feature: LangWatch Cloud receives the daily usage report
  A self-hosted install posts one anonymous usage report a day, to the app
  host's legacy address or to the connect host. Only LangWatch Cloud answers
  it: the report lands in the install registry and in product analytics.

  @unit
  Scenario: Cloud answers its own routes
    Given the process is LangWatch Cloud
    When a usage report arrives
    Then it is accepted

  @unit
  Scenario: Any other deployment refuses Cloud's routes by code
    Given the process is not LangWatch Cloud
    When a usage report arrives
    Then it is refused with the code "langwatch_cloud_only"
    And nothing is counted, recorded or sent

  @unit
  Scenario: Both doors hand the report to the same operation
    Given a report posted to "/api/track_usage" or to "/api/v1/connect/stats"
    When the door reads it
    Then the receiver gets the body, unknown fields included, and the sender's address headers

  @unit
  Scenario: A report without an install id is refused before the receiver runs
    Given a report body naming no install id
    When it is posted
    Then it is refused as a validation error and the receiver never runs

  @unit
  Scenario: An accepted report is recorded and sent to product analytics
    Given a report carrying a field this release has no name for
    When Cloud accepts it
    Then the install registry records the known fields and the count of unknown ones
    And product analytics receives the same event against the install id

  @unit
  Scenario: A report the registry cannot store is still accepted
    Given the install registry fails to record
    When Cloud accepts a report
    Then the sender is still answered and the failure is logged

  @unit
  Scenario: Reports past the global, per-address or per-install limit are refused
    Given the receiver is past one of its limits
    When a report arrives
    Then it is refused with the code "rate_limited" and nothing is recorded or sent
