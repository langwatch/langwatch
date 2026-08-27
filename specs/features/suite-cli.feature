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

  # ============================================================================
  # Run notes (Agent Testing v2)
  # ============================================================================
  # A note is a short line kept with one batch run. The domain rules are in
  # specs/suites/run-notes.feature and
  # specs/suites/run-note-metadata-convention.feature.

  @unit
  Scenario: Run a suite with a note
    Given my project has a suite with scenarios and active targets
    When I run "langwatch suite run <suite-id> --note 'nightly regression after the retry fix'"
    Then the suite run is scheduled with that note
    And the confirmation shows the note next to the batch run ID

  @unit
  Scenario: Run a suite with a note and wait for completion
    Given my project has a suite with scenarios and active targets
    When I run "langwatch suite run <suite-id> --note 'nightly regression' --wait"
    Then the run is scheduled with that note
    And the CLI polls until the run completes and shows pass/fail counts

  @unit
  Scenario: Run a suite with a note over two hundred characters
    When I run "langwatch suite run <suite-id> --note '<201 characters>'"
    Then I see an error that the note is too long
    And no run is scheduled

  @unit
  Scenario: Run a suite with a note of only spaces
    When I run "langwatch suite run <suite-id> --note '   '"
    Then the run is scheduled with no note

  # ============================================================================
  # Test suite folders (Agent Testing v2)
  # ============================================================================
  # Folder commands are nested under `suite` because a folder is a suite. The
  # domain rules are in specs/suites/suite-folders.feature.

  @unit
  Scenario: List test suite folders
    Given my project has test suite folders
    When I run "langwatch suite folder list"
    Then I see a table of folders with name, ID, and scenario count
    And custom run plans are not listed

  @unit
  Scenario: List test suite folders when none exist
    Given my project has no test suite folders
    When I run "langwatch suite folder list"
    Then I see a message indicating no folders were found

  @unit
  Scenario: Create a test suite folder
    When I run "langwatch suite folder create 'Refunds'"
    Then a new folder is created and I see confirmation with its name and ID
    And it holds no scenarios

  @unit
  Scenario: Create a test suite folder with a name another suite already uses
    Given my project has a run plan named "Refunds"
    When I run "langwatch suite folder create 'Refunds'"
    Then the folder is created with a distinct slug
    And I see confirmation with its name and ID

  @unit
  Scenario: Rename a test suite folder
    Given my project has a folder "Refunds"
    When I run "langwatch suite folder rename <folder-id> 'Refunds and credits'"
    Then the folder is renamed and I see confirmation

  @unit
  Scenario: Delete (archive) a test suite folder
    Given my project has a folder "Refunds" holding two scenarios
    When I run "langwatch suite folder delete <folder-id>"
    Then the folder is archived and I see confirmation
    And the confirmation says its scenarios were archived too

  @unit
  Scenario: Delete a test suite folder that does not exist
    When I run "langwatch suite folder delete nonexistent-id"
    Then I see an error that the folder was not found

  @unit
  Scenario: Run a test suite folder
    Given my project has a folder with scenarios and active targets
    When I run "langwatch suite run <folder-id>"
    Then a run is scheduled for every scenario of the folder against every active target
    And I see the job count and batch run ID

  @unit
  Scenario: Run a test suite folder that has no targets
    Given my project has a folder with scenarios and no targets
    When I run "langwatch suite run <folder-id>"
    Then I see an error that the folder has no target to run against
    And no run is scheduled

  @unit
  Scenario: Folder commands stay nested under the suite group
    When I run "langwatch --help"
    Then no top-level "folder" command group is listed
    And "langwatch suite --help" lists the "folder" subcommand group
