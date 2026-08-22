# See dev/docs/adr/113-a-pipeline-owns-a-set-of-aggregates.md for the
# architectural rationale. The pipeline's declared aggregate type was only ever
# an assertion: the stored row, the queue keys and replay all carry the event's
# own type. This feature makes a pipeline own a set of aggregate types and
# turns the assertion into ownership.
#
# The time-local rule for a set is already stated in fold-read-window.feature
# ("unless the fold's aggregates are time-local") and is not restated here.
# Kill-switch key shape lives in specs/ops/internal-feature-flags.feature.
# The single-aggregate shape lives in pipeline-model.feature and is unchanged.

@event-sourcing
Feature: Multi-aggregate pipeline

  A pipeline owns a set of aggregate types, each owning the event types that
  belong to it. One is the common case, not the rule. An event's aggregate is
  the one that owns its event type; a command binds to one aggregate
  explicitly; fold state on such a pipeline is keyed by type and id together,
  because the ids of two aggregates are not disjoint by construction.

  Background:
    Given an aggregate type "authz_grant" owning events:
      | lw.authz.grant.attached |
      | lw.authz.grant.revoked  |
    And an aggregate type "authz_role" owning events:
      | lw.authz.role.defined |
      | lw.authz.role.deleted |

  # ---------------------------------------------------------------------------
  # Declaring
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Declaring a pipeline with two aggregate types
    When I define a pipeline "authz_grant" with aggregate types "authz_grant" and "authz_role"
    Then the pipeline metadata lists aggregate types "authz_grant" and "authz_role"

  @unit
  Scenario: An event type may be owned by only one aggregate on a pipeline
    Given an aggregate type "authz_role_dup" also owning "lw.authz.grant.attached"
    When I define a pipeline with aggregate types "authz_grant" and "authz_role_dup"
    Then the pipeline build fails naming "lw.authz.grant.attached" as owned twice

  @unit
  Scenario: A single-aggregate pipeline is unchanged
    When I define a pipeline "trace_processing" with the single aggregate type "trace"
    Then the pipeline metadata lists the one aggregate type "trace"
    And a command registered without naming an aggregate binds to "trace"
    And the command's queue group key, dedup key and kill-switch key are unchanged

  # ---------------------------------------------------------------------------
  # Appending
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Appending an event of each aggregate to the shared pipeline
    Given a pipeline "authz_grant" with aggregate types "authz_grant" and "authz_role"
    When I store a "lw.authz.grant.attached" event stamped "authz_grant" with id "g1"
    And I store a "lw.authz.role.defined" event stamped "authz_role" with id "r1"
    Then both events are stored
    And each stored row carries the aggregate type the event was stamped with

  @unit
  Scenario: An event whose stamp disagrees with its event type's owner is rejected
    Given a pipeline "authz_grant" with aggregate types "authz_grant" and "authz_role"
    When I store a "lw.authz.role.defined" event stamped "authz_grant"
    Then the append fails with a validation error naming field "aggregateType"
    And nothing is stored

  @unit
  Scenario: An event type no declared aggregate owns is rejected
    Given a pipeline "authz_grant" with aggregate types "authz_grant" and "authz_role"
    When I store a "lw.obs.trace.span_received" event stamped "trace"
    Then the append fails with a validation error naming field "aggregateType"

  # ---------------------------------------------------------------------------
  # Commands
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A command on a multi-aggregate pipeline must name its aggregate
    Given a pipeline "authz_grant" with aggregate types "authz_grant" and "authz_role"
    When I register a command "defineRole" without naming an aggregate type
    Then the pipeline build fails naming the command and the pipeline's aggregate types

  @unit
  Scenario: A command may not bind to an aggregate its pipeline does not declare
    Given a pipeline "authz_grant" with aggregate types "authz_grant" and "authz_role"
    When I register a command "recordSpan" bound to aggregate type "trace"
    Then the pipeline build fails naming "trace" as undeclared

  @unit
  Scenario: A command's queue group key and kill-switch key use its bound aggregate
    Given a pipeline "authz_grant" with aggregate types "authz_grant" and "authz_role"
    And a command "defineRole" bound to "authz_role" whose aggregate id is the payload's roleId
    When I dispatch "defineRole" for tenant "org_1" with roleId "r1"
    Then the command's queue group key is "org_1:authz_role:r1"
    And the command's kill-switch key is "es-authz_role-command-defineRole-killswitch"

  # ---------------------------------------------------------------------------
  # Fold state
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Fold state on a multi-aggregate pipeline is keyed by type and id
    Given a pipeline "authz_grant" with aggregate types "authz_grant" and "authz_role"
    And a fold projection "ledger" over both aggregates' events
    When a "lw.authz.grant.attached" event for "x1" and a "lw.authz.role.defined" event for "x1" are folded
    Then the fold store holds a row keyed "authz_grant:x1" and a row keyed "authz_role:x1"
    And neither row was overwritten by the other

  @unit
  Scenario: Fold state on a single-aggregate pipeline keeps the bare id as its key
    Given a pipeline "trace_processing" with the single aggregate type "trace"
    And a fold projection "traceSummary"
    When a "lw.obs.trace.span_received" event for "t1" is folded
    Then the fold store holds a row keyed "t1"

  @unit
  Scenario: A re-fold loads the history of the event's own aggregate type
    Given a pipeline "authz_grant" with aggregate types "authz_grant" and "authz_role"
    And a fold projection "ledger" over both aggregates' events
    And stored "lw.authz.role.defined" events for "r1" at T1 and T3
    When a "lw.authz.role.defined" event for "r1" at T2 is delivered out of order
    Then the re-fold reads the event store with aggregate type "authz_role" and id "r1"
    And the folded state reflects T1, T2 and T3 in occurredAt order

  @unit
  Scenario: A store-miss re-fold pages the event's own aggregate type
    Given a pipeline "authz_grant" with aggregate types "authz_grant" and "authz_role"
    And a fold projection "ledger" that re-folds on store miss
    And stored "lw.authz.grant.attached" events for "g1"
    When a "lw.authz.grant.attached" event for "g1" is delivered and the fold store has no row
    Then the paged history is read with aggregate type "authz_grant" and id "g1"

  @unit
  Scenario: A fold with a custom event loader must declare itself type-aware on a multi-aggregate pipeline
    Given a pipeline "authz_grant" with aggregate types "authz_grant" and "authz_role"
    When I register a fold projection "ledger" with a custom event loader that is not type-aware
    Then the pipeline build fails naming "ledger" and the aggregate types it would conflate

  # ---------------------------------------------------------------------------
  # Operating
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A projection's kill-switch key on a multi-aggregate pipeline uses the pipeline name
    Given a registered pipeline "authz_grant" with aggregate types "authz_grant" and "authz_role"
    And a fold projection "ledger"
    Then the projection's kill-switch key is "es-authz_grant-projection-ledger-killswitch"

  @unit
  Scenario: Ops introspection lists every aggregate type the pipeline owns
    Given a registered pipeline "authz_grant" with aggregate types "authz_grant" and "authz_role"
    When I read the projection metadata for "ledger"
    Then it lists aggregate types "authz_grant" and "authz_role"
    And resolving the pipeline from aggregate type "authz_role" returns "authz_grant"
    And the pause key for "ledger" is "authz_grant/projection/ledger" regardless of aggregate type

  @integration
  Scenario: The authorization pipeline appends a role and a grant under their own types
    Given the authorization pipeline declaring "authz_grant" and "authz_role"
    When the ADR-110 migration states a role and then a grant for one organization
    Then the event log holds a row with aggregate type "authz_role" for the role
    And a row with aggregate type "authz_grant" for the grant
    And the ledger fold holds rows keyed "authz_role:<roleId>" and "authz_grant:<grantId>"
