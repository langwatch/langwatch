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

  Scenario: Email delivery caps are idempotent across retries
    Given a logical automation email dispatch has consumed a cap slot
    When its outbox delivery retries with the same deduplication key
    Then Automation re-reads the cap without consuming another slot
    And the per-project daily cap counts recipients rather than dispatches

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

  Scenario: Persist-cap containment pauses a condition-less automation once
    Given a condition-less trace automation has exceeded its daily persist cap
    When runaway containment evaluates the breach
    Then it claims the containment check before evaluating project traffic
    And it pauses the automation with the runaway reason
    And it sends at most one limit notification for the UTC day

  Scenario: Persist-cap containment leaves a busy filtered automation active
    Given a filtered automation has exceeded its daily persist cap
    And its confirmed matches cover less than 90 percent of at least 100 project traces
    When runaway containment evaluates the breach
    Then it leaves the automation active
    And it sends at most one ceiling notification for the UTC day

  Scenario: Graph threshold evaluation uses the singular AutomationService
    Given an active graph trigger and its custom graph
    When Eventing evaluates the trigger with a real-time or heartbeat reason
    Then threshold, no-data, delivery, retry, and open-incident decisions run through AutomationService
    And the service claims at most one open graph incident per trigger

  Scenario: Graph heartbeat isolates projects and metric sources
    Given graph triggers across trace-backed and evaluation-backed projects
    When the heartbeat checks recent slim-table activity
    Then it batches recency by project and source
    And a failed project does not suppress candidates for other projects
