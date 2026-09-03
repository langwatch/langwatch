Feature: Evaluator service boundary

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
