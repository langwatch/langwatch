Feature: Test Suite CLI Commands
  As a developer using LangWatch from the terminal
  I want to manage test suites and run them
  So that a group of scenarios can be kept and run without using the UI

  A test suite is a group of scenarios: a name and the scenarios filed in it.
  It holds no targets and no configuration. Running one is sugar over a run
  plan: the targets travel with the request and the platform files the run
  under a plan named after the test suite and its target unless a name is sent.

  The command group is "langwatch test-suite". "langwatch suite" is kept as an
  alias, so a command line written before the rename still runs.

  Background:
    Given I have a valid LANGWATCH_API_KEY configured

  # ==========================================================================
  # test-suite list, create, get, rename, archive
  # ==========================================================================

  @unit
  Scenario: List test suites
    Given my project has test suites
    When I run "langwatch test-suite list"
    Then I see a table with the name, ID and scenario count of each test suite
    And run plans are not listed

  @unit
  Scenario: List test suites when none exist
    Given my project has no test suites
    When I run "langwatch test-suite list"
    Then I see a message that no test suites were found

  @unit
  Scenario: Create a test suite
    When I run "langwatch test-suite create 'Refunds'"
    Then a new test suite is created and I see confirmation with its name and ID
    And it holds no scenarios

  @unit
  Scenario: Get a test suite by ID
    Given my project has a test suite "Refunds"
    When I run "langwatch test-suite get <suite-id>"
    Then I see its name, ID and the scenarios filed in it

  @unit
  Scenario: Get a test suite by name
    Given my project has a test suite "Refunds"
    When I run "langwatch test-suite get Refunds"
    Then the name is resolved to its ID and I see the same details

  @unit
  Scenario: Get a test suite that does not exist
    When I run "langwatch test-suite get nonexistent-id"
    Then I see an error that the test suite was not found

  @unit
  Scenario: Get a name two test suites share
    Given my project has two test suites named "Refunds"
    When I run "langwatch test-suite get Refunds"
    Then I see an error naming both IDs

  # ==========================================================================
  # Fields and evaluators
  # ==========================================================================

  @unit
  Scenario: Create a test suite with fields
    When I run "langwatch test-suite create 'Case lookups' --field golden_sql:text --field row_limit:number"
    Then the suite is created with those two fields, in that order
    And I see each field with its type

  @unit
  Scenario: A field with a type the platform does not have is refused
    When I run "langwatch test-suite create 'Case lookups' --field golden_sql:json"
    Then the command refuses the flag naming the three types
    And no suite is created

  @unit
  Scenario: A field whose identifier is reserved is refused
    When I run "langwatch test-suite create 'Case lookups' --field situation:text"
    Then the command refuses the flag with the reason
    And no suite is created

  @unit
  Scenario: Create a test suite with an evaluator whose mappings are inferred
    Given the project holds the evaluator "sql-query-equivalence" with the inputs output and expected_output
    When I run "langwatch test-suite create 'Case lookups' --field golden_sql:text --evaluator sql-query-equivalence"
    Then the suite is created with that evaluator attached, required
    And output reads the last agent message and expected_output reads the field golden_sql

  @unit
  Scenario: The gate flag applies to the evaluator written just before it
    Given the project holds two evaluators
    When I run "langwatch test-suite create 'Case lookups' --evaluator judge --not-required --evaluator scanner"
    Then the first attachment reports only and the second one is required

  @unit
  Scenario: A gate flag written before any evaluator is refused
    When I run "langwatch test-suite create 'Case lookups' --required --evaluator judge"
    Then the command refuses the flag, saying it must follow an --evaluator

  @unit
  Scenario: An evaluator that is not there is refused before anything is written
    Given the project holds no evaluator named "missing"
    When I run "langwatch test-suite create 'Case lookups' --evaluator missing"
    Then the command ends with the platform's refusal
    And no suite is created

  @unit
  Scenario: A required input the rules cannot map is reported, not refused
    Given the project holds an evaluator whose input expected_contexts matches no field
    When I run "langwatch test-suite create 'Case lookups' --field golden_sql:text --evaluator judge"
    Then the suite is created
    And stderr names the input that still needs a mapping

  @unit
  Scenario: The full attachment list comes from --evaluators-json
    When I run "langwatch test-suite create 'Case lookups' --field golden_sql:text --evaluators-json <file>"
    And the file maps output to the input of the run_sql tool call
    Then the suite is created with that attachment as written, its id generated

  @unit
  Scenario: A mapping to a field the suite does not declare is refused
    When I run "langwatch test-suite create 'Case lookups' --evaluators-json <json>"
    And the document maps expected_output to the field golden_sql
    Then the command refuses the document naming the field
    And no suite is created

  @unit
  Scenario: Update the fields of a test suite
    Given my project has a test suite "Case lookups" with one field
    When I run "langwatch test-suite update 'Case lookups' --field golden_sql:text --field table_schema:text"
    Then the suite is patched with those two fields and nothing else

  @unit
  Scenario: Update the evaluators of a test suite against its own fields
    Given my project has a test suite "Case lookups" declaring the field golden_sql
    When I run "langwatch test-suite update 'Case lookups' --evaluator sql-query-equivalence"
    Then the suite is patched with that evaluator alone
    And expected_output reads the field golden_sql

  @unit
  Scenario: Update the name of a test suite
    Given my project has a test suite "Case lookups"
    When I run "langwatch test-suite update 'Case lookups' --name 'Case lookups v2'"
    Then the suite is patched with the name alone

  @unit
  Scenario: An update with nothing to change is refused
    Given my project has a test suite "Case lookups"
    When I run "langwatch test-suite update 'Case lookups'"
    Then the command refuses, naming the four flags it reads
    And no request is sent

  @unit
  Scenario: Get a test suite shows its fields and evaluators
    Given my project has a test suite with one field and one evaluator
    When I run "langwatch test-suite get <suite-id>"
    Then I see the field with its type
    And I see the evaluator with its gate and every mapping

  @unit
  Scenario: Rename a test suite
    Given my project has a test suite "Refunds"
    When I run "langwatch test-suite rename <suite-id> 'Refunds and credits'"
    Then the test suite is renamed and I see confirmation
    And its slug is kept

  @unit
  Scenario: Archive a test suite
    Given my project has a test suite "Refunds" holding two scenarios
    When I run "langwatch test-suite archive <suite-id>"
    Then the test suite is archived and I see confirmation
    And the confirmation says the scenarios filed in it were archived too

  @unit
  Scenario: Archive a test suite that does not exist
    When I run "langwatch test-suite archive nonexistent-id"
    Then I see an error that the test suite was not found

  # ==========================================================================
  # test-suite run
  # ==========================================================================

  @unit
  Scenario: Run a test suite
    Given my project has a test suite with scenarios
    When I run "langwatch test-suite run <suite-id> --target http:agent_abc"
    Then every scenario filed in the test suite is run against that target
    And I see the plan name, the job count and the batch run ID

  @unit
  Scenario: Run a test suite by name
    Given my project has a test suite "Refunds"
    When I run "langwatch test-suite run Refunds --target http:agent_abc"
    Then the name is resolved to its ID and the run is scheduled

  @unit
  Scenario: Run a test suite against one agent on two models
    When I run "langwatch test-suite run Refunds --target 'http:agent_abc?model=gpt-5' --target 'http:agent_abc?model=gpt-5-mini'"
    Then the run is scheduled against two targets that name the same agent
    And each target carries the model value written after its question mark

  @unit
  Scenario: Run a test suite with no target
    When I run "langwatch test-suite run <suite-id>"
    Then I see an error that at least one --target is needed
    And no run is scheduled

  @unit
  Scenario: Run a test suite under a plan name
    Given my project has a run plan named "Nightly regression"
    When I run "langwatch test-suite run <suite-id> --target http:agent_abc --name 'Nightly regression'"
    Then the run joins that plan

  @unit
  Scenario: Run a test suite with a repeat count and models
    When I run "langwatch test-suite run <suite-id> --target http:agent_abc --repeat 3 --simulator-model openai/gpt-5-mini --judge-model openai/gpt-5-mini"
    Then the run carries the repeat count and both models

  @unit
  Scenario: Run a test suite with a note
    When I run "langwatch test-suite run <suite-id> --target http:agent_abc --note 'nightly regression after the retry fix'"
    Then the run is scheduled with that note
    And the confirmation shows the note next to the batch run ID

  @unit
  Scenario: Run a test suite with a note over two hundred characters
    When I run "langwatch test-suite run <suite-id> --target http:agent_abc --note '<201 characters>'"
    Then I see an error that the note is too long
    And no run is scheduled

  @unit
  Scenario: Run a test suite with a note of only spaces
    When I run "langwatch test-suite run <suite-id> --target http:agent_abc --note '   '"
    Then the run is scheduled with no note

  @unit
  Scenario: Run a test suite and wait for completion
    When I run "langwatch test-suite run <suite-id> --target http:agent_abc --wait"
    Then the CLI polls until every run of the batch has stopped
    And I see the pass and fail counts

  @unit
  Scenario: Wait for a test suite run with machine-readable output
    When I run "langwatch test-suite run <suite-id> --target http:agent_abc --wait" asking for JSON output
    Then exactly one final document carries the per-run results, the tallies and the outcome
    And no other line is printed on stdout

  # ==========================================================================
  # Command tree
  # ==========================================================================

  @unit
  Scenario: The test suite group holds no nested group
    When I run "langwatch test-suite --help"
    Then no nested subcommand group is listed
    And the subcommands are list, create, get, rename, archive and run

  @unit
  Scenario: The old suite name still runs
    When I run "langwatch suite list"
    Then the test suites are listed, the same as "langwatch test-suite list"

  @unit
  Scenario: Every test suite request declares the command line as its surface
    When I run any "langwatch test-suite" command
    Then the request carries the header "X-LangWatch-Surface: cli"
