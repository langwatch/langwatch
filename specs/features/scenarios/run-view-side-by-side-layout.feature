Feature: Scenario run detail drawer
  As a user reviewing scenario run results
  I want to see run details in a drawer overlaying the list/grid
  So that I can review criteria, conversation, and actions without leaving the runs view

  Background:
    Given I am viewing a batch run list or grid

  @integration
  Scenario: Clicking a run opens the detail drawer
    When I click on a scenario run in the list
    Then a drawer slides in from the right
    And the list/grid remains visible but dimmed behind it

  @integration
  Scenario: Drawer header shows run identity and status
    Given a completed scenario run "Echo user request" for "target-A" that failed in 6.3 seconds
    When the detail drawer opens for that run
    Then the header displays the scenario name, target name, failure status, and duration

  @integration
  Scenario: Criteria section shows pass/fail summary
    Given a run with 4 criteria where 0 passed
    When the detail drawer opens for that run
    Then the criteria section shows "0/4 passed"
    And each criterion displays its name and pass/fail indicator

  @integration
  Scenario: Failed criteria show expandable reasoning
    Given a run with a failed criterion that has reasoning text
    When the detail drawer opens for that run
    Then the failed criterion has an expandable reasoning section

  @integration
  Scenario: Conversation section displays chat messages
    Given a run with a user message and an assistant reply
    When the detail drawer opens for that run
    Then the conversation section displays the message exchange
    And a "View Trace" link is available for the conversation

  @integration
  Scenario: Drawer content scrolls when it overflows
    Given a run with many criteria and a long conversation
    When the detail drawer opens for that run
    Then the drawer body scrolls vertically to reveal all content

  @integration
  Scenario: Closing the drawer returns to the list view
    Given the detail drawer is open
    When I click the close button
    Then the drawer closes
    And the list/grid is fully visible again
