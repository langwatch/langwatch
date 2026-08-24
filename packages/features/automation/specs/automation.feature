Feature: Automation ownership

  Scenario: One automation capability owns subordinate lifecycles
    Given the automation service
    When trigger definitions, trigger-fire history, report schedules, and email suppression are used
    Then they share the singular automation ownership boundary
    And callers do not select separate trigger or suppression services

  Scenario: Automations are scoped to a project
    Given an automation service
    When an automation is read by id and project
    Then it returns only the automation belonging to that project

  Scenario: Project-wide email suppression applies to a trigger
    Given an email suppressed for a project
    When recipients are filtered for a trigger in that project
    Then the suppressed address is removed regardless of casing

  Scenario: Missing report schedules are repaired without resuming paused reports
    Given an active report trigger without a scheduler row
    And another report trigger with a paused scheduler row
    When the automation service reconciles report schedules
    Then it creates the missing schedule
    And it leaves the paused schedule inactive

  Scenario: Reports are not dispatched as trace or graph triggers
    Given an active report trigger with a report source
    When active automation projections are loaded for dispatch
    Then the report trigger is absent from both trace and graph projections
