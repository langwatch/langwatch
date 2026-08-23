# Companion to event-subscriber-visibility and process-manager-visibility:
# the directly-readable state projections (registered with .withProjection(),
# running as __jobType=stateProjection) get the registry-times-live-health
# treatment on the /ops/event-sourcing page's projections section — the same
# join folds and maps already have.

Feature: State-projection visibility in ops
  As an operator during an incident
  I want every registered projection listed with its live queue health,
  whatever kind it is
  So that a stalled authorization or conversation projection is seen, not
  discovered from raw queries

  Context: the projections table joined the registry to the live tree for
  fold and map projections only. The seven state projections — including the
  authorization grants ledger's — ran with counters and warn-logs but no row
  on the page, no settable kill switch, and no way into the replay wizard.
  Map projections had a row but its live counts could never join: their jobs
  run under the handler job type, which the tree normalized to the fold node,
  while the join looked under map — so every map row read idle forever.

  Background:
    Given an operator is viewing the event sourcing page

  @unit
  Scenario: Every state projection is listed, idle or not
    Given a pipeline registering a projection for direct reads
    When the projection registry metadata is collected
    Then the projection appears with its pipeline and aggregate type
    And its pause key addresses the state-projection queue path

  @unit
  Scenario: A state projection's live backlog joins its registry row
    Given a state projection with pending and blocked groups in the live tree
    When the projection health is joined
    Then its row carries those pending, active, and blocked counts

  @unit
  Scenario: A map projection's live jobs light up its row
    Given a map projection with live jobs running under the handler job type
    When the pipeline tree is built
    Then those jobs file under the map node
    And the projection health join finds them

  @unit
  Scenario: State projection throughput counts as projection work
    Given state-projection jobs moving through the queue
    When the dashboard aggregates throughput by phase
    Then that work counts in the projections phase, not commands

  @unit
  Scenario: A state projection's kill switch can be reached from the flags page
    Given a registered state projection
    When the kill-switch descriptors are generated
    Then a descriptor exists whose key matches the one the runtime checks
