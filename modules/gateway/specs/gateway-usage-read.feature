Feature: The Usage page reads an organization's usage in one statement per figure

  A key's traces land in whichever project resolved as its trace destination,
  so the Usage page reads across every project of the organization. Each of
  its trace reads is one statement over the organization's tenant set: one
  statement per project fills the ClickHouse statement queue in an
  organization with many projects, and the page then shows "Failed to load
  usage" with clickhouse_overloaded instead of the numbers.

  @integration @spend
  Scenario: The Usage page's summary is read in one statement however many projects the organization has
    Given an organization with 400 projects
    And a virtual key whose traces landed in two of them, costing 0.75 and 0.50
    And every trace read passes the process's ClickHouse statement admission
    When the Usage page reads this month's summary
    Then the total is 1.25 over 2 requests, all on that key
    And trace was asked for usage buckets once, over all 400 projects

  @integration @spend
  Scenario: One key's usage is read in two statements however many projects the organization has
    Given an organization with 400 projects
    And a virtual key whose traces landed in two of them, costing 0.75 and 0.50
    And every trace read passes the process's ClickHouse statement admission
    When the Usage page reads that key's summary
    Then the total is 1.25 over 2 requests
    And its recent requests list both traces, newest first
    And trace was asked once for usage buckets and once for recent traces
