Feature: Audit logging
  Security-sensitive application actions are recorded through one portable
  capability without exposing request-framework or persistence types. The
  capability is Enterprise: an installation without it records nothing and
  reads an empty history.

  @unit
  Scenario: A recorded entry is readable as the entity's history
    Given a process that installed the audit log
    When a management write is recorded against an entity
    Then the entity's history names the actor and the action

  @unit
  Scenario: Legacy agent audit identifiers are repaired without guessing
    Given legacy create and copy audit entries omit generated identifiers
    When the explicit repair executes through the system migration runner
    Then candidates are scoped to the audit project's one-minute creation window
    And copied agents also match the recorded source agent
    And only a unique candidate is linked
    And ambiguous projects remain held rather than finalized
    And a repeated pass does not rewrite repaired entries

  @unit
  Scenario: The legacy audit repair is explicitly invoked
    When the task runs without --execute
    Then it reports potential repairs without writing data or migration checkpoints
    And ordinary API and worker startup do not register this migration

  Scenario: Project-rooted repair uses project checkpoints and organization enrollment
    Given a cloud organization is enrolled in a project-rooted migration
    When the runner processes a project in that organization
    Then enrollment is checked against the organization identifier
    And execution and persisted migration state use the project identifier

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
