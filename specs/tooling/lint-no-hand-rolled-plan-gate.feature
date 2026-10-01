Feature: The no-hand-rolled-plan-gate lint rule
  A plan gate is declared on the route or procedure, as
  `withEntitlement(entitlement, { feature, when })`, and the framework asks it
  after access: 401, then 403, then 402. A module's service that throws the
  refusal itself forks that order and the refusal's shape. The rule reports the
  refusal class and the contract's assertion helpers in a module's process
  `app/` and `transport/` code. A gate that needs loaded data lives in a
  `services/` method, which the rule leaves alone.

  @unit
  Scenario: A plan refusal thrown in the application is reported
    Given an application that throws the Enterprise plan refusal
    When the no-hand-rolled-plan-gate rule runs over it
    Then it reports handRolledPlanGate and names the declaration to use

  @unit
  Scenario: The contract's plan assertions are refusals too
    Given an application that calls assertEnterprisePlanType and assertEnterprisePlan
    When the no-hand-rolled-plan-gate rule runs over it
    Then it reports each call on its own line

  @unit
  Scenario: A plan refusal in an enterprise process package is reported
    Given an enterprise module's application that throws the Enterprise plan refusal
    When the no-hand-rolled-plan-gate rule runs over it
    Then it reports it

  @unit
  Scenario: Naming the refusal or reading the plan is not a refusal
    Given an application that only tests for the refusal and reads the active plan
    When the no-hand-rolled-plan-gate rule runs over it
    Then it reports nothing

  @unit
  Scenario: A plan refusal thrown in a transport declaration is reported
    Given a transport declaration that throws the Enterprise plan refusal
    When the no-hand-rolled-plan-gate rule runs over it
    Then it reports it

  @unit
  Scenario: A plan refusal in a service is not this rule's business
    Given a process service that refuses a plan on data it loaded
    When the no-hand-rolled-plan-gate rule runs over it
    Then it reports nothing

  @unit
  Scenario: A test file may build the refusal
    Given a test file that builds the Enterprise plan refusal
    When the no-hand-rolled-plan-gate rule runs over it
    Then it reports nothing
