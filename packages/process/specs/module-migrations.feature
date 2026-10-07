Feature: A module declares its migration steps beside its tasks

  The owning module declares its code steps with `.withMigrations`, built over its own
  app, repositories and peers as `.withTasks` builds tasks; the tasks and worker roles
  collect them over the installed list and the api never builds one. The step contract
  is `@langwatch/upgrade/step`. Plan: dev/docs/plans/migrations-rethink-2026-10-06.md 6.1,
  6.2 and 6.5; dev/docs/plans/migrations-blitz-2026-10-06.md 5.3.

  @unit
  Scenario: A module builds its migration steps over its own booted app
    Given a module that declares `.withMigrations(({ app }) => [step])`
    When a tasks process installs it
    Then the module's steps are built over the app it just installed

  @unit
  Scenario: The tasks and worker roles build a module's migration steps and the api never does
    Given a module that declares two migration steps
    When it is installed in the tasks role, the worker role and the api role
    Then the tasks and worker installs hold both steps, in declaration order
    And the api install holds none and never runs the module's binder

  @unit
  Scenario: Migration steps are collected over the installed list in installation order
    Given two installed modules that each declare migration steps
    When the steps are collected
    Then every step is answered once, in installation order, beside its declaring module

  @unit
  Scenario: A step id not prefixed with its declaring module is refused by name
    Given the module "dataset" declares a step "annotation:copy-keys"
    When the steps are collected
    Then collection refuses, naming the module "dataset" and the step "annotation:copy-keys"

  @unit
  Scenario: A step id declared twice across the installed list is refused by name
    Given the module "dataset" declares the step "dataset:copy-keys" twice
    When the steps are collected
    Then collection refuses, naming the module "dataset" and the step "dataset:copy-keys"

  @unit
  Scenario: A module that declared something other than a migration step is named
    Given the module "dataset" declares a value that is not a migration step
    When the steps are collected
    Then collection refuses, naming the module "dataset"

  @unit
  Scenario: A migration step declared without a description is refused by name
    When the module "evaluation" defines the step "evaluation:backfill-scores" with a blank description
    Then the definition refuses, naming the module "evaluation" and the step "evaluation:backfill-scores"

  @unit
  Scenario: A blocking migration step whose kind is not data is refused by name
    When the module "evaluation" defines the blocking step "evaluation:enrol-tenants" of kind "tenant"
    Then the definition refuses, naming the module "evaluation" and the step "evaluation:enrol-tenants"
    And it says only a data step may block

  @unit
  Scenario: A migration step id that is not a module and a kebab name is refused by name
    When a step is defined with the id "Evaluation/BackfillScores"
    Then the definition refuses, naming the id and the "<module>:<kebab-name>" shape

  @unit
  Scenario: The step guard accepts a defined step and nothing else
    Given a step made with `defineMigrationStep`
    Then the guard accepts it
    And it rejects a task, a step with no run function and a blocking tenant step built by hand

  @unit
  Scenario: A defined step runs with its checkpoint, dry-run flag and signal and returns its report
    Given a background data step that counts the rows it would copy
    When it runs as a dry run resuming from a checkpoint
    Then it is handed the checkpoint, the dry-run flag and the abort signal
    And it returns its report

  @unit
  Scenario: A booted tasks or worker process answers its migration steps and the api refuses
    Given a tasks process and a worker process that install a module declaring two steps
    When each is asked for its migration steps with the step guard
    Then each answers both steps
    And an api process asked the same refuses, naming the role it actually is

  @unimplemented
  Scenario: A blocking step's run is frozen SQL pinned to its own release's schema
    Given a module declares a blocking data step
    When the tree is linted
    Then the lint rule `langwatch/frozen-blocking-step` refuses a run that imports a service, a repository or another module's contract
    And it accepts a run that executes only SQL text held in the step's own file
