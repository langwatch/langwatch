Feature: Ops counts one tenant's group queue work for a staff investigation
  A staff ops function asks ops how much queue work belongs to an organization: per queue, how
  many of its groups wait, are blocked, are running, are parked over the tenant cap or sit in the
  dead-letter queue, how many jobs wait and since when. A group key starts with the eventing
  tenant id (a project id for project pipelines, an organization id for organization pipelines),
  so the caller names both forms. The answer carries counts and one time only, never a group key,
  a job payload or error text (ADR-202, amendment 2026-11-25).

  @integration
  Scenario: A tenant's groups are counted per queue
    Given a queue holding waiting, blocked, running, parked and dead-lettered groups of a project
    When ops counts the queue groups for that project
    Then the queue shows each count, the waiting jobs and the oldest waiting job's time

  @integration
  Scenario: Another tenant's groups are never counted
    Given a queue holding groups of two projects
    When ops counts the queue groups for one of them
    Then only that project's groups are counted
    And a queue holding none of its groups is left out

  @integration
  Scenario: Project and organization tenant ids are counted together
    Given a queue holding a project's groups and its organization's groups
    When ops counts the queue groups for the project id and the organization id
    Then both are counted in the queue's totals

  @integration
  Scenario: The counts carry no key, payload or error text
    When ops counts the queue groups for a project
    Then no answer carries a group key, a job payload or an error message
