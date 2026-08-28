Feature: Scenario CLI Commands
  As a developer using LangWatch from the terminal
  I want to manage scenarios via CLI commands
  So that I can define and maintain agent test scenarios without using the UI

  Background:
    Given I have a valid LANGWATCH_API_KEY configured

  Scenario: List scenarios
    Given my project has scenarios configured
    When I run "langwatch scenario list"
    Then I see a table of all scenarios with name, labels, and criteria count

  Scenario: List scenarios when none exist
    Given my project has no scenarios
    When I run "langwatch scenario list"
    Then I see a message indicating no scenarios were found

  Scenario: Get scenario details by ID
    Given my project has a scenario with name "Login Flow"
    When I run "langwatch scenario get <scenario-id>"
    Then I see scenario details including name, situation, criteria, and labels

  Scenario: Get scenario that does not exist
    When I run "langwatch scenario get nonexistent-id"
    Then I see an error that the scenario was not found

  Scenario: Create a scenario
    When I run "langwatch scenario create 'Login Flow' --situation 'User attempts to log in'"
    Then a new scenario is created and I see confirmation with its name and ID

  Scenario: Create a scenario with criteria and labels
    When I run "langwatch scenario create 'Login Flow' --situation 'User logs in' --criteria 'Greets user,Asks for password' --labels 'auth,happy-path'"
    Then a new scenario is created with the specified criteria and labels

  Scenario: Create a scenario without required situation
    When I run "langwatch scenario create 'Login Flow'"
    Then I see an error that the --situation option is required

  Scenario: Update a scenario
    Given my project has a scenario with name "Login Flow"
    When I run "langwatch scenario update <scenario-id> --name 'Updated Login Flow'"
    Then the scenario is updated and I see confirmation

  Scenario: Update a scenario with new criteria
    Given my project has a scenario with name "Login Flow"
    When I run "langwatch scenario update <scenario-id> --criteria 'New criterion 1,New criterion 2'"
    Then the scenario criteria are replaced with the new values

  Scenario: Delete (archive) a scenario
    Given my project has a scenario with name "Login Flow"
    When I run "langwatch scenario delete <scenario-id>"
    Then the scenario is archived and I see confirmation

  Scenario: Delete a scenario that does not exist
    When I run "langwatch scenario delete nonexistent-id"
    Then I see an error that the scenario was not found

  Scenario: Run scenario command without API key
    Given LANGWATCH_API_KEY is not set
    When I run "langwatch scenario list"
    Then I see an error prompting me to configure my API key

  # ============================================================================
  # Test suite membership (Agent Testing v2)
  # ============================================================================
  # A scenario belongs to at most one test suite. The domain rules are
  # in specs/suites/suite-folders.feature and
  # specs/scenarios/scenario-folder-assignment.feature.

  @unit
  Scenario: Create a scenario inside a test suite
    Given my project has a test suite "folder_abc"
    When I run "langwatch scenario create 'Login Flow' --situation 'User logs in' --folder folder_abc"
    Then the scenario is created inside that folder
    And the confirmation names the folder

  @unit
  Scenario: Move a scenario to another test suite
    Given my project has a scenario and a test suite "folder_xyz"
    When I run "langwatch scenario update <scenario-id> --folder folder_xyz"
    Then the scenario is moved to that folder
    And it no longer belongs to the folder it was in

  @unit
  Scenario: Unfile a scenario from its test suite
    Given my project has a scenario inside a folder
    When I run "langwatch scenario update <scenario-id> --no-folder"
    Then the scenario belongs to no folder

  @unit
  Scenario: Create a scenario with a test suite that does not exist
    When I run "langwatch scenario create 'Login Flow' --situation 'User logs in' --folder nonexistent-id"
    Then I see an error that the test suite was not found
    And no scenario is created

  @unit
  Scenario: Combining --folder and --no-folder is rejected
    When I run "langwatch scenario update <scenario-id> --folder folder_abc --no-folder"
    Then I see an error that the two options cannot be used together
    And the scenario is unchanged

  @unit
  Scenario: List scenarios shows the folder each one belongs to
    Given my project has scenarios inside and outside test suites
    When I run "langwatch scenario list"
    Then the table has a folder column
    And a scenario with no folder reads as unfiled

  # ============================================================================
  # Running one scenario (Agent Testing v2)
  # ============================================================================
  # Running a scenario is sugar over a run plan: one request, scoped to the one
  # case. No suite is created for it, and none is deleted afterwards. The
  # platform files the run under a plan named after the scenario and the target
  # unless a name is sent. See specs/features/run-plan-cli.feature.

  @unit
  Scenario: Run a scenario against a target
    Given my project has a scenario "Login Flow" and an HTTP agent
    When I run "langwatch scenario run <scenario-id> --target http:agent_abc"
    Then one run request is sent, scoped to that one case
    And no test suite is created or deleted
    And I see the plan name, the job count and the batch run ID

  @unit
  Scenario: Run a scenario against more than one target
    When I run "langwatch scenario run <scenario-id> --target http:agent_abc --target prompt:prompt_xyz"
    Then the run is scheduled against both targets

  @unit
  Scenario: Run a scenario under a plan name
    Given my project has a run plan named "Login checks"
    When I run "langwatch scenario run <scenario-id> --target http:agent_abc --name 'Login checks'"
    Then the run joins that plan

  @unit
  Scenario: Run a scenario more than once
    When I run "langwatch scenario run <scenario-id> --target http:agent_abc --repeat 3"
    Then the configuration carries the repeat count

  @unit
  Scenario: Run a scenario with no target
    When I run "langwatch scenario run <scenario-id>"
    Then I see an error that at least one --target is needed
    And no run is scheduled

  @unit
  Scenario: Run a scenario with a note
    Given my project has a scenario "Login Flow" and an HTTP agent
    When I run "langwatch scenario run <scenario-id> --target http:agent_abc --note 'after the timeout fix'"
    Then the run is scheduled with that note
    And the note is shown in the confirmation

  @unit
  Scenario: Run a scenario with a note over two hundred characters
    When I run "langwatch scenario run <scenario-id> --target http:agent_abc --note '<201 characters>'"
    Then I see an error that the note is too long
    And no run is scheduled

  @unit
  Scenario: Run a scenario with a note of only spaces
    When I run "langwatch scenario run <scenario-id> --target http:agent_abc --note '   '"
    Then the run is scheduled with no note

  @unit
  Scenario: Running a scenario declares the command line as its surface
    When I run "langwatch scenario run <scenario-id> --target http:agent_abc"
    Then the request carries the header "X-LangWatch-Surface: cli"

  # ============================================================================
  # Versions (Agent Testing v2)
  # ============================================================================
  # See specs/scenarios/scenario-versioning.feature.

  @unit
  Scenario: List the versions of a scenario
    Given my project has a scenario that was edited twice
    When I run "langwatch scenario version list <scenario-id>"
    Then I see the versions newest first with number, author, date, and changed fields

  @unit
  Scenario: Get one version of a scenario
    Given my project has a scenario with three versions
    When I run "langwatch scenario version get <scenario-id> 2"
    Then I see the name, situation, criteria, and labels as they were at version 2

  @unit
  Scenario: Get a version that does not exist
    Given my project has a scenario with three versions
    When I run "langwatch scenario version get <scenario-id> 9"
    Then I see an error that the version was not found

  @unit
  Scenario: Updating a scenario from the command line records a new version
    Given my project has a scenario at version 1
    When I run "langwatch scenario update <scenario-id> --name 'Updated Login Flow'"
    Then the scenario is at version 2
    And the new version names the command line as its author
