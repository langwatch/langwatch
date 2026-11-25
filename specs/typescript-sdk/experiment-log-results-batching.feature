Feature: TypeScript SDK sizes logResults requests by bytes
  As a TypeScript SDK user running experiments over rows with inline images
  I want the results sent in requests the server accepts
  So that a batch of large rows is logged instead of refused

  # Results are batched by time. One row can carry megabytes of inline images,
  # so a batch is also split by its serialized size. The target is 16 MiB of
  # results per request, which every server version accepts. Requests are sent
  # one after another, so they arrive in order.

  @unit
  Scenario: A logResults batch larger than the request target is sent as several requests
    Given an experiment over seven rows of 5 MB each
    When the experiment finishes
    Then the results are sent in several requests
    And no request holds more results than the request target

  @unit
  Scenario: Split logResults requests keep the results in their original order
    Given an experiment over seven rows of 5 MB each
    When the experiment finishes
    Then the rows and evaluations arrive in the order they were logged
    And every request names the same run

  @unit
  Scenario: Only the last split logResults request marks the run as finished
    Given an experiment over seven rows of 5 MB each
    When the experiment finishes
    Then only the last request carries the finished timestamp

  @unit
  Scenario: A single result larger than the logResults request target is sent alone
    Given an experiment over an 18 MB row between two small ones
    When the experiment finishes
    Then the 18 MB result is sent in a request of its own

  @unit
  Scenario: A logResults request refused as too large is split and sent again
    Given a server that accepts at most 8 MB per request
    And an experiment over five rows of 3 MB each
    When the experiment finishes
    Then the refused request is cut in two and sent again
    And every result is logged in order with the finished timestamp last

  @unit
  Scenario: A single result the server refuses as too large is reported with its size
    Given a server that accepts at most 4 MB per request
    And an experiment whose second row is 6 MB
    When the experiment finishes
    Then an error is logged that names the row index and its size
    And the other results are logged and the run is still marked as finished

  # The platform stores results after they are reported, so a reader needs the
  # run's own totals to tell a run still being stored from a whole one.

  @unit
  Scenario: The request that ends the run carries the counts the run reported
    Given an experiment over three small rows with one evaluation each
    When the experiment finishes
    Then the request that carries the finished timestamp reports 3 rows and 3 evaluations expected
