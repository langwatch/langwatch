# See dev/docs/adr/113-a-pipeline-owns-a-set-of-aggregates.md for the
# architectural rationale. The pipeline's declared aggregate type was only ever
# an assertion: the stored row, the queue keys and replay all carry the event's
# own type. This feature makes a pipeline own a set of aggregates and turns the
# assertion into ownership.
Feature: Multi-aggregate pipeline

  A pipeline owns a set of aggregates. One is the common case, not the rule.
  An event's aggregate is whatever the catalogue says its event type belongs
  to; a command binds to one aggregate explicitly; two aggregates sharing a
  pipeline carry ids that cannot collide.

  Background:
    Given an aggregate "authz_grant" with id prefix "grant_" and events:
      | lw.authz.grant.attached |
      | lw.authz.grant.revoked  |
    And an aggregate "authz_role" with id prefix "role_" and events:
      | lw.authz.role.defined |
      | lw.authz.role.deleted |

  @unit
  Scenario: Declaring a pipeline with two aggregates
    When I define a pipeline "authz" with aggregates "authz_grant" and "authz_role"
    Then the pipeline's allowed event types are the union of both aggregates' events
    And the pipeline metadata lists aggregate types "authz_grant" and "authz_role"

  @unit
  Scenario: A single-aggregate pipeline is unchanged
    When I define a pipeline "trace_processing" with the single aggregate "trace"
    Then the pipeline metadata lists the one aggregate type "trace"
    And a command registered without naming an aggregate binds to "trace"
    And the command's queue group key is the same as before this change

  @unit
  Scenario: Appending an event of each aggregate to the shared pipeline
    Given a pipeline "authz" with aggregates "authz_grant" and "authz_role"
    When I store a "lw.authz.grant.attached" event stamped "authz_grant" with id "grant_01"
    And I store a "lw.authz.role.defined" event stamped "authz_role" with id "role_01"
    Then both events are stored
    And each stored row carries the aggregate type the event was stamped with

  @unit
  Scenario: An event whose stamp disagrees with its event type is rejected
    Given a pipeline "authz" with aggregates "authz_grant" and "authz_role"
    When I store a "lw.authz.role.defined" event stamped "authz_grant"
    Then the append fails with a validation error naming field "aggregateType"
    And nothing is stored

  @unit
  Scenario: An event of an aggregate the pipeline does not own is rejected
    Given a pipeline "authz" with aggregates "authz_grant" and "authz_role"
    And an aggregate "trace" owning "lw.obs.trace.span_received"
    When I store a "lw.obs.trace.span_received" event stamped "trace"
    Then the append fails with a validation error naming field "aggregateType"

  @unit
  Scenario: The stronger check also protects a single-aggregate pipeline
    Given a pipeline "authz_grant_only" with the single aggregate "authz_grant"
    When I store a "lw.authz.role.defined" event stamped "authz_grant"
    Then the append fails with a validation error naming field "aggregateType"

  @unit
  Scenario: A command on a multi-aggregate pipeline must name its aggregate
    Given a pipeline "authz" with aggregates "authz_grant" and "authz_role"
    When I register a command "defineRole" without naming an aggregate
    Then the pipeline build fails naming the command and the pipeline's aggregates

  @unit
  Scenario: A command may not bind to an aggregate its pipeline does not declare
    Given a pipeline "authz" with aggregates "authz_grant" and "authz_role"
    When I register a command "recordSpan" bound to aggregate "trace"
    Then the pipeline build fails naming "trace" as undeclared

  @unit
  Scenario: A command's queue group key uses its bound aggregate
    Given a pipeline "authz" with aggregates "authz_grant" and "authz_role"
    And a command "defineRole" bound to "authz_role" whose aggregate id is the payload's roleId
    When I dispatch "defineRole" for tenant "org_1" with roleId "role_01"
    Then the command's queue group key is "org_1:authz_role:role_01"

  @unit
  Scenario: Two aggregates on one pipeline must have distinct id prefixes
    Given an aggregate "authz_role_clash" with id prefix "grant_"
    When I define a pipeline with aggregates "authz_grant" and "authz_role_clash"
    Then the pipeline build fails naming the shared prefix "grant_"

  @unit
  Scenario: An aggregate on a multi-aggregate pipeline must declare an id prefix
    Given an aggregate "authz_role_unprefixed" with no id prefix
    When I define a pipeline with aggregates "authz_grant" and "authz_role_unprefixed"
    Then the pipeline build fails naming "authz_role_unprefixed" as unprefixed

  @unit
  Scenario: A single aggregate needs no id prefix
    Given an aggregate "trace" with no id prefix
    When I define a pipeline with the single aggregate "trace"
    Then the pipeline is built

  @unit
  Scenario: A command producing an id outside its aggregate's prefix is rejected before the handler runs
    Given a pipeline "authz" with aggregates "authz_grant" and "authz_role"
    And a command "defineRole" bound to "authz_role" whose aggregate id is the payload's roleId
    When I dispatch "defineRole" with roleId "grant_01"
    Then the command fails with a validation error naming field "aggregateId"
    And the handler is not invoked

  @unit
  Scenario: A re-fold loads the history of the event's own aggregate type
    Given a pipeline "authz" with aggregates "authz_grant" and "authz_role"
    And a fold projection "ledger" over both aggregates' events
    And stored "lw.authz.role.defined" events for "role_01" at T1 and T3
    When a "lw.authz.role.defined" event for "role_01" at T2 is delivered out of order
    Then the re-fold reads the event store with aggregate type "authz_role" and id "role_01"
    And the folded state reflects T1, T2 and T3 in occurredAt order

  @unit
  Scenario: A store-miss re-fold pages the event's own aggregate type
    Given a pipeline "authz" with aggregates "authz_grant" and "authz_role"
    And a fold projection "ledger" that re-folds on store miss
    And stored "lw.authz.grant.attached" events for "grant_01"
    When a "lw.authz.grant.attached" event for "grant_01" is delivered and the fold store has no row
    Then the paged history is read with aggregate type "authz_grant" and id "grant_01"

  @unit
  Scenario: The time-local gate requires every declared aggregate to be time-local
    Given an aggregate "log" that is time-local and an aggregate "authz_role" that is not
    When I define a pipeline with aggregates "log" and "authz_role"
    And I register a fold projection that trusts an absent windowed read
    Then the pipeline build fails naming "authz_role" as not time-local

  @unit
  Scenario: Replay of a multi-aggregate pipeline carries each aggregate's own type
    Given a pipeline "authz" with aggregates "authz_grant" and "authz_role"
    And stored events for "grant_01" and "role_01"
    When I replay the "ledger" projection since the beginning
    Then "grant_01" is replayed as aggregate type "authz_grant"
    And "role_01" is replayed as aggregate type "authz_role"

  @unit
  Scenario: Ops introspection lists every aggregate type the pipeline owns
    Given a registered pipeline "authz" with aggregates "authz_grant" and "authz_role"
    When I read the projection metadata for "ledger"
    Then it lists aggregate types "authz_grant" and "authz_role"
    And resolving the pipeline from aggregate type "authz_role" returns "authz"
    And the pause key for "ledger" is "authz/projection/ledger" regardless of aggregate type

  @integration
  Scenario: The authorization pipeline appends a role and a grant under their own types
    Given the authorization pipeline declaring "authz_grant" and "authz_role"
    When the ADR-110 migration states a role and then a grant for one organization
    Then the event log holds a row with aggregate type "authz_role" for the role
    And a row with aggregate type "authz_grant" for the grant
    And the ledger fold for the organization reflects both
