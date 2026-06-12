Feature: Run-until-here dialog
  As a user testing a workflow in the optimization studio
  I want to pick the exact values a partial run executes with
  So that I can probe a node's behavior without editing the dataset or hunting for hidden run settings

  # Replaces the entry drawer's "Manual Test Entry" row picker
  # (first/last/random/specific), which configured a hidden global and
  # confused everyone on the customer call. The choice now happens at
  # the moment it matters: clicking "Run workflow until here" on a node
  # opens a dialog asking which values to run with. Last-submitted
  # values persist on the entry node in the workflow DSL
  # (manual_run_values), so the dialog remembers them across sessions.

  Background:
    Given I am logged in
    And I have a workflow with an entry point and a connected node

  @integration
  Scenario: The entry drawer offers no manual test entry picker
    Given a dataset is attached to the entry point
    When I open the entry point drawer
    Then I do not see a manual test entry section

  @integration
  Scenario: Run-until-here opens a dialog with one field per workflow input
    When I click "Run workflow until here" on a node
    Then a dialog opens instead of the run starting
    And it shows one field per entry point input
    And it shows a Run button and a Cancel button

  @integration
  Scenario: Fields prefill from the first dataset row
    Given a dataset is attached to the entry point
    And no values were submitted before
    When the run-until-here dialog opens
    Then each field is prefilled with the first dataset row's value for that column

  @integration
  Scenario: Fields prefill from the last submitted values
    Given I previously ran until a node with edited values
    When the run-until-here dialog opens again
    Then each field is prefilled with the values from that last run
    And those values live in the workflow DSL so they survive a reload

  @integration
  Scenario: Running executes until the target node with the typed values
    Given the run-until-here dialog is open
    When I edit a field and click Run
    Then the dialog closes
    And the execution starts scoped to the target node
    And the entry point outputs are the typed values instead of a dataset row

  @integration
  Scenario: Select dataset value is only offered with an attached dataset
    Given the entry point has no dataset attached
    When the run-until-here dialog opens
    Then there is no "Select dataset value" button

  @integration
  Scenario: Selecting a dataset row to run with
    Given a dataset is attached to the entry point
    And the run-until-here dialog is open
    When I click "Select dataset value"
    Then the dialog shows the dataset rows as a table
    And rows highlight on hover and select on click
    And "Run with selected row" appears at the bottom right once a row is selected
    And Cancel returns to the fields view

  @integration
  Scenario: Running with a selected row uses that row's values
    Given the dataset table view has a row selected
    When I click "Run with selected row"
    Then the execution starts scoped to the target node
    And the entry point outputs are the selected row's values
    And the dialog remembers them as the last submitted values

  @integration
  Scenario: Opening run-until-here with a saved dataset does not loop
    Given a saved multi-column dataset is attached to the entry point
    And the dataset rows arrive as a fresh array reference on every render
    When the run-until-here dialog renders on studio load
    Then it settles without exceeding the maximum render depth
    And the fields prefill from the first dataset row
