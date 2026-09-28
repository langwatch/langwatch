Feature: Audit logging
  Security-sensitive application actions are recorded through one portable
  capability without exposing request-framework or persistence types. Every
  deployment records audit entries (ARCHITECTURE.md section 4, 2026-09-24), and
  the home screen's recent-items strip is read from the caller's own entries.

  @unit
  Scenario: A recorded entry is readable as the entity's history
    Given a process that installed the audit log
    When a management write is recorded against an entity
    Then the entity's history names the actor and the action

  @unit
  Scenario: Legacy agent audit identifiers are repaired without guessing
    Given legacy create and copy audit entries omit generated identifiers
    When the backfill task runs
    Then candidates are scoped to the audit project's one-minute creation window
    And copied agents also match the recorded source agent
    And only a unique candidate is linked
    And an ambiguous entry is skipped and counted
    And a repeated pass does not rewrite repaired entries

  @unit
  Scenario: The legacy audit repair is explicitly invoked
    When the task runs with --dry-run
    Then it reports potential repairs without writing data
    And without --dry-run it writes, as main's script did
    And ordinary API and worker startup do not run it

  @unit
  Scenario: Entity history stays inside the requested project and action family
    Given audit entries name an entity in id, agentId or newAgentId arguments
    And other projects and action families have entries naming the same entity
    When the caller lists that project's agents history with those argument keys
    Then only matching project and action entries are returned newest first
    And the requested history limit is applied
    And stored author identifiers remain available for caller-owned enrichment

  @unit
  Scenario: A valid audit command is persisted
    Given an audit service with a repository
    When a caller records an action with JSON arguments and request metadata
    Then one bounded audit record is written

  @unit
  Scenario: the home strip answers an empty trail with no items
    Given the audit log installed over memory repositories
    When somebody with no recent activity reads the home strip
    Then they are answered with no items

  @unit
  Scenario: the home strip lists what the caller touched, newest first and each once
    Given somebody touched a workflow twice, a prompt, a monitor, an annotation queue and a dataset
    When they read the home strip
    Then each entity is listed once, at its newest touch, newest first
    And each is named and linked through its owner's existing read

  @unit
  Scenario: the home strip hides what is gone and never lists simulations
    Given somebody touched a deleted prompt, an archived workflow, a missing workflow and a simulation
    When they read the home strip
    Then none of them is listed

  @unit
  Scenario: the home strip shows only the caller's own touches
    Given somebody else touched a workflow in the project
    When the caller reads the home strip
    Then that workflow is not listed

  @integration
  Scenario: the composed api process keeps its audit entries in the installed audit-log module
    Given the api process composed as its main composes it, over memory stores
    When an audit entry is recorded for a prompt
    Then the prompt's history answers that entry

  @unimplemented
  Scenario: a browser mutation's audit entry reaches the home strip in the composed api process
    Given the api process composed with the audit-log module
    When somebody updates a workflow through the browser door
    Then the audit trail records the mutation
    And their home strip lists the workflow
