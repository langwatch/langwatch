Feature: Suite (Run Plan) CLI Commands
  As a developer using LangWatch from the terminal
  I want to manage suites (run plans) via CLI commands
  So that I can orchestrate scenario execution against targets without using the UI

  Background:
    Given I have a valid LANGWATCH_API_KEY configured

  Scenario: List suites
    Given my project has suites configured
    When I run "langwatch suite list"
    Then I see a table of all suites with name, slug, scenario count, and target count

  Scenario: List suites when none exist
    Given my project has no suites
    When I run "langwatch suite list"
    Then I see a message indicating no suites were found

  Scenario: Get suite details by ID
    Given my project has a suite with name "Regression Suite"
    When I run "langwatch suite get <suite-id>"
    Then I see suite details including name, slug, scenarios, targets, and repeat count

  Scenario: Get suite that does not exist
    When I run "langwatch suite get nonexistent-id"
    Then I see an error that the suite was not found

  Scenario: Create a suite
    Given my project has scenarios "scenario_1" and "scenario_2"
    When I run "langwatch suite create 'Regression Suite' --scenarios scenario_1,scenario_2 --targets http:agent_abc"
    Then a new suite is created and I see confirmation with its name and ID

  Scenario: Create a suite with repeat count and labels
    Given my project has scenarios and agents configured
    When I run "langwatch suite create 'Load Test' --scenarios s1 --targets http:a1 --repeat-count 5 --labels regression,nightly"
    Then a new suite is created with repeat count 5 and the specified labels

  Scenario: Create a suite without required scenarios
    When I run "langwatch suite create 'Test' --targets http:agent_1"
    Then I see an error that the --scenarios option is required

  Scenario: Create a suite without required targets
    When I run "langwatch suite create 'Test' --scenarios scenario_1"
    Then I see an error that the --targets option is required

  Scenario: Update a suite
    Given my project has a suite with name "Regression Suite"
    When I run "langwatch suite update <suite-id> --name 'Updated Suite'"
    Then the suite is updated and I see confirmation

  Scenario: Duplicate a suite
    Given my project has a suite with name "Regression Suite"
    When I run "langwatch suite duplicate <suite-id>"
    Then a copy of the suite is created with "(copy)" appended to the name

  Scenario: Run a suite
    Given my project has a suite with scenarios and active targets
    When I run "langwatch suite run <suite-id>"
    Then the suite run is scheduled and I see the job count and batch run ID

  Scenario: Run a suite and wait for completion
    Given my project has a suite with scenarios and active targets
    When I run "langwatch suite run <suite-id> --wait"
    Then the CLI polls until the run completes and shows pass/fail counts

  # Structured output for `suite run`: a machine caller gets exactly one
  # final JSON document on stdout, whichever way the run ends. Exit codes do
  # not change: 1 on failures, timeout or a dead status endpoint, 0 otherwise.
  # Human output stays as it was.

  @unit
  Scenario: Run a suite with machine-readable output
    Given my project has a suite with scenarios and active targets
    When I run "langwatch suite run <suite-id>" asking for JSON output
    Then exactly one machine-readable document is printed on stdout
    And it carries the batch run ID, set ID, job count and a scheduled outcome

  @unit
  Scenario: Wait for a suite run with machine-readable output
    Given my project has a suite with scenarios and active targets
    When I run "langwatch suite run <suite-id> --wait" asking for JSON output
    Then the CLI polls until the run completes
    And exactly one final document carries the per-scenario results, the tallies and the outcome
    And the exit code is nonzero when any scenario failed

  @unit
  Scenario: A timed-out wait still emits the machine-readable document
    Given a suite run whose jobs never complete
    When the wait times out
    Then the final document names the timeout outcome
    And the exit code is nonzero

  @unit
  Scenario: A dead status endpoint still emits the machine-readable document
    Given a suite run whose status endpoint keeps failing
    When the wait gives up
    Then the final document names the poll failure outcome
    And the exit code is nonzero

  @unit
  Scenario: Waiting in human mode prints no machine document
    Given my project has a suite with scenarios and active targets
    When I run "langwatch suite run <suite-id> --wait" with the default output
    Then the progress and completion lines stay human-readable
    And no JSON document is printed

  Scenario: Delete (archive) a suite
    Given my project has a suite with name "Regression Suite"
    When I run "langwatch suite delete <suite-id>"
    Then the suite is archived and I see confirmation

  Scenario: Run a scenario against a target
    Given my project has a scenario "Login Flow" and an HTTP agent
    When I run "langwatch scenario run <scenario-id> --target http:agent_abc"
    Then an ephemeral suite is created, run is scheduled, and the suite is cleaned up

  Scenario: List simulation run results
    Given my project has completed simulation runs
    When I run "langwatch simulation-run list"
    Then I see a list of runs with status, duration, and cost

  Scenario: Get simulation run details
    Given my project has a completed simulation run
    When I run "langwatch simulation-run get <run-id>"
    Then I see full run details including conversation messages, verdict, and criteria
