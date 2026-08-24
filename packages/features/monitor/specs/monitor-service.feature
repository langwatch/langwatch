Feature: Monitor service boundary

  Scenario: Creating a monitor requires a project evaluator
    Given a monitor create command without an evaluator
    When the Monitor service creates it
    Then MonitorEvaluatorRequiredError is thrown

  Scenario: Updating a legacy monitor may preserve its missing evaluator
    Given an existing legacy monitor
    When the update omits evaluatorId
    Then the monitor is updated without evaluator validation

  Scenario: Explicitly removing an evaluator is rejected
    Given an evaluator-backed monitor
    When the update sets evaluatorId to null
    Then MonitorEvaluatorRequiredError is thrown

  Scenario: Monitor mappings are canonicalised
    Given a create or update command with empty mappings
    When the Monitor service persists it
    Then mappings contain mapping and expansions keys

  Scenario: Runtime reads are project scoped
    Given monitors in two projects
    When a project reads enabled ON_MESSAGE monitors
    Then only that project's enabled ON_MESSAGE monitors are returned

  Scenario: Missing monitor reads throw
    Given no monitor exists for the project and id
    When a caller requests it
    Then MonitorNotFoundError is thrown
