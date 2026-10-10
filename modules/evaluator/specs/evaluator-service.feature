Feature: Evaluator service boundary

  @unit @composition
  Scenario: A process composes one evaluator capability
    Given the application composes the evaluator adapter at startup
    When a REST or tRPC handler requests an evaluator
    Then both handlers use the same contract service instance
    And neither handler constructs a repository or database client

  @unit
  Scenario: Missing evaluators have explicit result semantics
    Given an evaluator is not present in the requested project
    When a caller uses the nullable lookup
    Then the service returns null
    When a caller uses the ordinary lookup
    Then the service throws the evaluator not found domain error

  @integration
  Scenario: The memory and Postgres evaluator repositories answer alike
    Given the same cases run against the memory twin and against Postgres
    When an evaluator is written, read by id, by slug and by its workflow,
      updated, archived, and listed as a copy of another project's evaluator
    Then both backends answer the same rows in the same order
    And both answer an absence with undefined rather than a refusal
    And neither answers with a row belonging to another project

  @unit
  Scenario: Evaluator persistence stays behind the server boundary
    Given an evaluator is loaded from Postgres
    When the repository maps the row
    Then the returned value conforms to the contract schema
    And no generated Prisma type crosses the package boundary

  @unit
  Scenario: Evaluator vocabulary has one portable source
    Given a host renders or validates a built-in or code evaluator
    When it needs the catalogue, code defaults, or a display name
    Then it imports that vocabulary from the evaluator contract
    And it does not duplicate that vocabulary in an application module

  @integration
  Scenario: Reusable evaluator UI remains browser-safe
    Given a browser host supplies evaluator availability and navigation callbacks
    When it renders an evaluator picker, card, or editor chrome
    Then the reusable UI uses only the evaluator contract for domain values
    And router, tRPC, Monaco, field-mapping, API-usage, copy, and cascade composition remain in the host

  # The studio's evaluator switch moved here from workflow's optimization.* (round 26, CD-2):
  # workflow keeps the flags, evaluator the row that wraps a workflow published as one.
  @unit
  Scenario: An archived workflow keeps its evaluator publication behaviour
    Given an archived workflow whose publication row still exists
    When a caller saves it as an evaluator
    Then the publication flags and evaluator use that row's name

  @unit
  Scenario: Saving a workflow as an evaluator creates the one evaluator that wraps it
    Given a workflow no evaluator wraps yet
    When a caller saves it as an evaluator
    Then one workflow evaluator named after the workflow is created

  @unit
  Scenario: Saving a missing workflow as an evaluator refuses before publication changes
    Given no workflow publication row exists for the requested project and id
    When a caller saves it as an evaluator
    Then workflow_not_found is reported and no publication changes

  @unit
  Scenario: Switching a workflow off as an evaluator archives the evaluator that wrapped it
    Given a workflow published as an evaluator
    When a caller switches it off as an evaluator
    Then the workflow's evaluator flag is cleared
    And the evaluator that wrapped it is archived, if one did

  @unit
  Scenario: A workflow's archive preview names its evaluators at the workflow's grain
    Given a member who may view workflows but not evaluations
    When the archive dialog asks which evaluators the workflow backs
    Then evaluators.listByWorkflow answers under workflows:view
    And it names each live evaluator by id and name only
