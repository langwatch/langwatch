Feature: A pipeline declares its tenants' retention
  As a module whose projections write tenant rows
  I want my pipeline to state each tenant's retention from my own data-retention dependency
  So that live rows age out under the tenant's policy, as main's runtime-wide policy cache did.

  # Ruled 2026-09-28 (ARCHITECTURE §9): the pipeline declares its resolver with `.withRetention`,
  # built from its module's DataRetentionApi dependency, and registration prefers it to the
  # runtime's. No late-bound resolver on the eventing member.

  @unit
  Scenario: A pipeline's rows take each tenant's retention from the pipeline's own resolver
    Given a pipeline declaring its tenants' retention
    When events for two tenants with different policies are projected
    Then each tenant's rows are stamped with that tenant's own retention

  @unit
  Scenario: A pipeline's resolver wins over the runtime's
    Given a runtime with a retention resolver of its own
    And a pipeline declaring its tenants' retention
    When an event is projected
    Then the row takes the pipeline's answer and the runtime's resolver is never asked

  @unit
  Scenario: A pipeline declaring no retention leaves its rows to the store's default
    Given a pipeline declaring no retention in a runtime with none
    When an event is projected
    Then its store is handed no policy and stamps its own default

  @unit
  Scenario: A projection whose tenant retention cannot be read writes no row with a guessed retention
    Given a pipeline whose retention resolver refuses
    When an event is projected
    Then no row is written with a default in place of the tenant's retention

  # Trace, evaluation, langy, coding-agent, scenario and suite each bind this in their own tests.
  @unit
  Scenario: A module's pipeline declares each tenant's retention from data retention
    Given a module whose projections write tenant rows, depending on data retention
    When its consuming pipeline is built
    Then the pipeline's retention resolver answers what data retention resolves for the tenant

  @unit
  Scenario: A job whose value fails its schema is refused once, not retried
    Given a queue whose handler throws a schema error for the job's value
    When the queue's worker handles the job
    Then the failure is non-retryable so the job is not attempted again
    And other failures still surface unchanged and retryable
