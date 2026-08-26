Feature: Running one test case keeps the person in place
  As a person who just edited one test case
  I want to run it and watch it without leaving the table
  So that I keep my place in the list and still see the conversation happen

  Background: what happens on Run.
    Run on a test case row opens the run dialog. When the run is confirmed, the
    page does not change address. The run detail drawer opens over the table
    and the conversation streams into it. When the conversation ends, the judge
    verdict appears in the same drawer.

    The run is filed under One-off runs, so it can be found again later. See
    specs/suites/one-off-runs-surface.feature.

  # --- Staying in place ---

  @integration
  Scenario: Confirming a run from a case row does not change the address
    Given the case table is open at All test cases
    When Run is confirmed on a case row
    Then the address stays where it was
    And the case table is still behind the drawer

  @integration
  Scenario: Confirming a run from inside a test suite keeps that suite selected
    Given the test suite "Refunds" is selected
    When Run is confirmed on one of its case rows
    Then "Refunds" is still selected in the rail
    And the address still names that suite

  # --- The drawer ---

  @integration
  Scenario: The run detail drawer opens as soon as the run is queued
    Given a case row with a target chosen
    When the run is confirmed
    Then the run detail drawer opens
    And it shows the run as queued
    And it names the test case and the target

  @integration
  Scenario: The conversation streams into the drawer while the run goes on
    Given the run detail drawer is open on a running one-off run
    When the agent and the simulated user exchange messages
    Then each message appears in the drawer as it arrives
    And the drawer does not need a reload

  @integration
  Scenario: The judge verdict appears after the conversation ends
    Given a one-off run whose conversation has ended
    When the judge finishes
    Then the verdict appears in the drawer
    And each criterion reads as met or not met
    And the duration and the cost of the run read in the drawer

  @integration
  Scenario: The drawer offers Rerun and Edit for that case
    Given the run detail drawer is open on a finished one-off run
    When its header is read
    Then Rerun and Edit are offered
    And Edit opens the editor for that test case

  @integration
  Scenario: Closing the drawer leaves the table where it was
    Given the run detail drawer is open over the case table
    When the drawer is closed
    Then the same table is shown, at the same scroll position
    And the last result of that row now reads the new verdict

  # --- Where the run lands ---

  @integration
  Scenario: The finished one-off run is listed under One-off runs
    Given a finished one-off run of the case "Angry refund request"
    When the Results tab is opened and "One-off runs" is chosen
    Then a run named "Angry refund request" is listed
    And choosing it shows the same results the drawer showed

  # --- Stopping ---

  @integration
  Scenario: A one-off run can be stopped from the drawer
    Given the drawer is open on a running one-off run
    When Stop is chosen
    Then the run stops
    And the drawer reads that the run was stopped

  # --- Failure paths ---

  @integration
  Scenario: A run that cannot start says why in the drawer
    Given a target that is not reachable
    When a one-off run against it is confirmed
    Then the drawer opens and reads the named failure
    And it does not read "unknown error"

  @integration
  Scenario: A run refused before it is queued keeps the dialog open
    Given a project with no model provider set up
    When a one-off run is confirmed
    Then the run dialog stays open and reads what is missing
    And it offers to open the model provider settings
    And no drawer opens

  # --- v1 is unchanged ---

  @integration
  Scenario: The v1 page still sends the person to the run after a single run
    Given the Agent Testing release flag is off
    When a single test case is run from the v1 page
    Then the person is sent to the run, as they are today
