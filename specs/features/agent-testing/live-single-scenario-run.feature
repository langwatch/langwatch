Feature: Running one scenario keeps the person in place
  As a person who just edited one scenario
  I want to run it and watch it without leaving the table
  So that I keep my place in the list and still see the conversation happen

  Background: what happens on Run.
    Run on a scenario row opens the run dialog. When the run is confirmed, the
    page does not change address. The run detail drawer opens over the table
    and the conversation streams into it. When the conversation ends, the judge
    verdict appears in the same drawer.

    The run is an ordinary run plan. Its name is the scenario name followed by
    the agent, the same way a suite run is named, so running the same scenario
    against the same agent again stacks run 1, run 2 and run 3 on one plan and
    the plan grows a trend. Running it against another agent is another name,
    so it is another plan. See specs/suites/run-plan-identity-by-name.feature.

  # --- Staying in place ---

  @integration
  Scenario: Confirming a run from a case row does not change the address
    Given the case table is open at All scenarios
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
    And it names the scenario and the target

  @integration
  Scenario: The conversation streams into the drawer while the run goes on
    Given the run detail drawer is open on a running single-scenario run
    When the agent and the simulated user exchange messages
    Then each message appears in the drawer as it arrives
    And the drawer does not need a reload

  @integration
  Scenario: The judge verdict appears after the conversation ends
    Given a single-scenario run whose conversation has ended
    When the judge finishes
    Then the verdict appears in the drawer
    And each criterion reads as met or not met
    And the duration and the cost of the run read in the drawer

  @integration
  Scenario: The drawer offers Open Scenario for that case
    Given the run detail drawer is open on a finished single-scenario run
    When its header is read
    Then a single "Open Scenario" button is offered
    And it opens the editor for that scenario
    And a rerun is started from the case editor through its "Save & Run" control

  @integration
  Scenario: Closing the drawer leaves the table where it was
    Given the run detail drawer is open over the case table
    When the drawer is closed
    Then the same table is shown, at the same scroll position
    And the last result of that row now reads the new verdict

  # --- Where the run lands ---

  @integration
  Scenario: The run goes out under a plan named after the scenario and the agent
    Given the case "Angry refund request" and the agent "prod-agent"
    When Run is confirmed on that case row
    Then the run goes out under the name "Angry refund request prod-agent"
    And that run plan covers only that one case

  @integration
  Scenario: Running the same case against the same agent again joins the same plan
    Given the case "Angry refund request" was already run against "prod-agent"
    When it is run against "prod-agent" again
    Then both runs go out under the same name
    And the second run joins the plan the first one created

  @integration
  Scenario: Running the same case against another agent is another plan
    Given the case "Angry refund request" and the agents "prod-agent" and "dev-agent"
    When the case is run against "dev-agent"
    Then the run goes out under the name "Angry refund request dev-agent"

  # --- Stopping ---

  @integration
  Scenario: A single-scenario run can be stopped from the drawer
    Given the drawer is open on a running single-scenario run
    When Stop is chosen
    Then the run stops
    And the drawer reads that the run was stopped

  # --- Failure paths ---

  @integration
  Scenario: A run that cannot start says why in the drawer
    Given a target that is not reachable
    When a single-scenario run against it is confirmed
    Then the drawer opens and reads the named failure
    And it does not read "unknown error"

  @integration
  Scenario: A run refused before it is queued keeps the dialog open
    Given a project with no model provider set up
    When a single-scenario run is confirmed
    Then the run dialog stays open and reads what is missing
    And it offers to open the model provider settings
    And no drawer opens

  # --- v1 is unchanged ---

  @integration
  Scenario: The v1 page still sends the person to the run after a single run
    Given the Agent Testing release flag is off
    When a single scenario is run from the v1 page
    Then the person is sent to the run, as they are today
