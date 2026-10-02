Feature: Suite service

  @unit
  Scenario: Create a suite definition
    Given a project has no suite with the requested slug
    When a caller creates the suite through app.suites
    Then the service stores it with a generated id and slug

  @unit
  Scenario: Reject a colliding suite name
    Given a project already has a suite with the requested slug
    When a caller creates another suite with that slug
    Then the service reports that the suite name is taken

  @unit
  Scenario: Resolve a run through owning feature services
    Given a suite references scenarios, agents or prompts
    When a caller starts the suite through app.suites
    Then Suite asks the canonical owning services to resolve those references
    And its execution port schedules the durable run

  @unit
  Scenario: Read a missing suite
    Given a suite does not exist in the project
    When a caller requests that suite
    Then the service reports that the suite was not found

  @unit
  Scenario: Renaming a missing suite reports the suite error
    Given no suite exists for a requested suite id
    When a caller renames that suite
    Then the suite boundary reports suite_not_found

  @unit
  Scenario: Archiving a missing suite reports the suite error
    Given no suite exists for a requested suite id
    When a caller archives that suite
    Then the suite boundary reports suite_not_found

  @unit
  Scenario: A run's evaluators are its test suite's, then its plan's own, each listed once
    Given a scenario filed in a test suite that was archived after the run was queued
    And the run plan the run was filed under attaches evaluators of its own
    When the evaluators the run carries are read
    Then the test suite's attachments come first, then the plan's
    And an evaluator attached on both sides is listed once, as the suite's copy

  @unit
  Scenario: A stored run plan reads back although its row carries fields and evaluators
    Given a run plan row that also holds the fields and evaluators columns
    When the Prisma suite repository creates or reads it
    Then it answers the run plan rather than refusing the extra columns

  @unit @regression
  Scenario: A test suite write refuses an evaluator the project does not hold
    Given a test suite in the project
    When it is created or edited with an evaluator id the project does not hold
    Then the write is refused with suite_evaluator_not_found
    And the test suite is not written

  @unit @regression
  Scenario: A test suite edit refuses dropping a field an attached evaluator still reads
    Given a test suite whose attached evaluator reads one of its fields
    When an edit removes that field and keeps the evaluator
    Then the edit is refused with suite_field_in_use

  # Main's SuiteRunService.startRun: a run the queue refused has no run and never
  # will, so a caller waiting on its scenarioRunId would wait forever.
  @unit @regression
  Scenario: A run the queue refused is left out of the batch it answers
    Given a suite run over two scenarios
    And the queue refuses the first scenario's run
    When the suite run is started
    Then the answer counts one queued run
    And lists only the run that was queued

  # The suite starts its run on suite_run_processing and hands each scenario run
  # to the scenario owner, which records the run's metadata (main's startRun).
  @unit @regression
  Scenario: Running a stored run plan through the process schedules its runs
    Given the suite module installed in the api role over memory persistence
    When a stored run plan is run
    Then its suite run is started and its scenario run is queued by the scenario owner
    And the run is not refused with service_unavailable

  # Main stamped these beside the target on every suite run; the result atoms and
  # run configurations read targetKey back out of the reserved namespace.
  @unit @regression
  Scenario: A suite run's target key, target overrides and plan models reach the queued run
    Given a suite run against a target with overrides, on a plan naming both models
    When the scenario owner queues one of its runs
    Then the run's reserved namespace records the target key and the target's overrides
    And it records the models the plan was configured with

  @unit
  Scenario: The list surface renders a deep link when a public base URL is configured
    Given a deployment that configured a public base URL
    When the suite module builds a platform link
    Then it answers a link on that base URL

  @unit
  Scenario: The list surface refuses a deep link by name when no public base URL is configured
    Given a deployment that named no public base URL
    When the suite module builds a platform link
    Then it is refused by name
