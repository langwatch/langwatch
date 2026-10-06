Feature: Python SDK sizes log_results requests by bytes
  As a Python SDK user running experiments over rows with inline images
  I want the results sent in requests the server accepts
  So that a batch of large rows is logged instead of refused

  # Results are batched by time. One row can carry megabytes of inline images,
  # so a batch is also split by its serialized size. The target is 16 MiB of
  # results per request, which every server version accepts.

  @unit
  Scenario: A log_results batch larger than the request target is sent as several requests
    Given an experiment with seven pending results of 5 MB each
    When the experiment finishes
    Then the results are sent in three requests
    And no request holds more results than the request target

  @unit
  Scenario: Split log_results requests keep the results in their original order
    Given an experiment with seven pending results of 5 MB each
    When the experiment finishes
    Then the rows and evaluations arrive in the order they were logged
    And every request names the same run

  @unit
  Scenario: Only the last split log_results request marks the run as finished
    Given an experiment with seven pending results of 5 MB each
    When the experiment finishes
    Then only the last request carries the finished timestamp

  @unit
  Scenario: A split log_results batch of an unfinished run carries no finished marker
    Given an experiment with three pending results of 9 MB each
    When the batch is sent while the run is still going
    Then no request carries the finished timestamp

  @unit
  Scenario: A log_results batch under the request target is sent as one request
    Given an experiment with three pending results of 1 MB each
    When the experiment finishes
    Then the results are sent in one request

  @unit
  Scenario: A single result larger than the log_results request target is sent alone
    Given an experiment with a pending result of 18 MB between two small ones
    When the experiment finishes
    Then the 18 MB result is sent in a request of its own

  @unit
  Scenario: A log_results request refused as too large is split and sent again
    Given a server that accepts at most 8 MB per request
    And an experiment with four pending results of 3 MB each
    When the experiment finishes
    Then the refused request is cut in two and sent again
    And every result is logged in order with the finished timestamp last

  @unit
  Scenario: A single result the server refuses as too large raises an error naming its size
    Given a server that accepts at most 4 MB per request
    And a batch whose second result is 6 MB
    When the batch is sent
    Then a LogResultsTooLargeError is raised that names the row index and its size
    And the other results are logged and the run is still marked as finished

  @unit
  Scenario: A refused log_results request is not retried
    Given a server that accepts at most 4 MB per request
    And an experiment with one pending result of 6 MB
    When the experiment finishes
    Then the request is sent once

  @unit
  Scenario: The legacy batch evaluation splits a large log_results batch the same way
    Given a legacy batch evaluation body with four results of 7 MB each
    When the body is split
    Then two requests hold two results each
    And only the last one carries the finished timestamp
