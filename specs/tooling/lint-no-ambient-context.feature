Feature: The no-ambient-context lint rule
  In module code a scope travels as a named parameter, never through
  AsyncLocalStorage (ARCHITECTURE.md section 3.2). The framework's trace
  context in packages/observability is outside the rule. One named exception
  remains: the http channels in the auth module that adapt Better Auth, a
  third-party seam whose logger and callbacks the framework cannot reach with
  a parameter (Alex, 2026-10-06).

  @unit
  Scenario: A module's source does not carry a scope through AsyncLocalStorage
    Given module source that creates an AsyncLocalStorage
    When the no-ambient-context rule runs over it
    Then it reports ambientContext
    And the message tells the reader to pass the scope as a named parameter

  @unit
  Scenario: Auth's Better Auth http channels may use AsyncLocalStorage
    Given a modules/auth/process/src/channels/http/http.*.channel.ts file that creates an AsyncLocalStorage
    When the no-ambient-context rule runs over it
    Then it reports nothing, because it adapts Better Auth, a seam the framework cannot reach
    And any other file in the auth module still reports ambientContext

  @unit
  Scenario: Framework packages and tests are not governed
    Given a file in packages/observability or a test file that creates an AsyncLocalStorage
    When the no-ambient-context rule runs over it
    Then it reports nothing
