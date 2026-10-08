Feature: Analytics panel error state

  When an analytics query fails, for example because the search ran past its
  memory limit, the panel that asked for it shows one compact error state
  inside its own bounds. Panels on one page usually fail together, so the
  state stays small enough to repeat across a dashboard without covering
  neighbouring panels, and the copy comes from the handled-error registry by
  code, never from the raw error message.

  Background:
    Given a project with the analytics overview open

  @integration
  Scenario: A failed chart panel shows a compact message and a Retry
    Given a chart panel whose query fails with "This search was too large"
    When the panel renders
    Then it shows the registry headline and one line of advice inside the panel
    And it shows a Retry button
    And the server's remediation tips are not listed
    And the error id is offered as a small copy action

  @integration
  Scenario: Retry in a panel refetches every failed analytics panel
    Given several analytics panels on the page have failed
    When the user clicks Retry in one panel body
    Then every failed analytics query on the page is fetched again
    And panels that loaded are not fetched again

  @integration
  Scenario: A failed summary in a tab header shows a compact indicator
    Given a summary figure drawn inside a tab header
    When its query fails
    Then the tab header keeps the figure label
    And shows a warning icon with "Couldn't load" in place of the number
    And the registry copy and the error id are in a tooltip
    And no error card or button is drawn inside the tab header

  @integration
  Scenario: A failed summary card shows one compact indicator
    Given a summary card with several figures
    When its query fails
    Then the card shows one "Couldn't load" indicator for the whole row

  @integration
  Scenario: Top used documents shows the same compact error state
    Given the top used documents query fails
    When the documents section renders
    Then the total documents tab header shows the compact indicator
    And the documents table shows the compact panel message with a Retry

  @integration @regression
  Scenario: A failed documents section stays visible and does not refetch on its own
    Given the top used documents query always fails with "This search was too large"
    When the documents section renders and a few seconds pass
    Then the section and its error state with a Retry stay on screen
    And the query is not fetched again on its own
    When the user clicks Retry
    Then exactly one more request is sent
    And the section and its Retry stay on screen while it runs

  @unit @regression
  Scenario: A panel read that runs out of ClickHouse memory fails with the handled memory error
    Given ClickHouse refuses an analytics panel read with code 241
    When the analytics repository reads that panel
    Then it fails with "query_memory_exceeded", status 422 and a customer fault
    And the raw ClickHouse error is kept as its reason

  @integration
  Scenario: A failed topics panel shows the error state with a Retry
    Given the topic counts query has failed
    When the Top Topics panel renders
    Then it shows the compact panel message in place of the loading bars
    And its Retry fetches the topic counts again
