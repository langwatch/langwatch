# See ../adrs/20260828-trpc-framework-boundary.md
Feature: tRPC framework boundary

  @typecheck @architecture
  Scenario: A root preserves concrete transport types
    Given a root declares a context and a procedure input
    When a router caller invokes that procedure
    Then its context, input and output remain concrete
    And the framework imports no application or feature module

  @typecheck @architecture
  Scenario: A procedure cannot be built without an authorization declaration
    Given a procedure has declared its input
    When no permission, opt-out or in-service authorization is declared
    Then the builder offers no query or mutation to call
    And the procedure does not compile

  @unit
  Scenario: A secret typed into a scalar field never reaches the audit trail
    Given a mutation whose action path carries its secret in a top-level field
    When its arguments are prepared for the audit trail
    Then that field's value is redacted
    And the field name is kept

  @unit
  Scenario: A slow call is raised without burying the log
    Given a call succeeds slower than its budget
    When it is recorded
    Then it is warned about at most once per interval per path
    And the next warning reports how many calls went unwarned
