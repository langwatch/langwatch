Feature: One bulk-archive event per set instead of N per-run delete events
  As an SRE who later replays history to reconstruct a customer's view
  I need a single `lw.simulation_set.archived` event per set archive
  So I can answer "who archived what set when?" without clustering N events
  by setId+timestamp.

  Background: tracking lw#3636. Today archiving a set fans out into N
  `lw.simulation_run.deleted` events — one user intent producing many
  events with no audit-time link. The new `simulation_set` aggregate
  carries the bulk action as one event whose payload snapshots the
  affected `scenarioRunIds`.

  This slice ships only the schemas + command + type guard. Wiring the
  event into the per-run fold projection (so each run's `ArchivedAt`
  flips) requires a dispatcher fanout — tracked as a follow-up.

  @unit
  Scenario: ArchiveSetCommand emits a SimulationSetArchived event with the snapshotted run ids
    Given a tenant archives a set with three runs
    When the ArchiveSetCommand handler runs
    Then a single event with type "lw.simulation_set.archived" is produced
    And the event data carries the scenarioSetId
    And the event data carries all three scenarioRunIds

  @unit
  Scenario: ArchiveSetCommand idempotency key collapses retries on the same set
    Given two ArchiveSetCommand invocations for the same scenarioSetId
    When idempotency keys are computed
    Then both keys are identical

  @unit
  Scenario: isSimulationSetArchivedEvent narrows the event type
    Given a SimulationProcessingEvent of type "lw.simulation_set.archived"
    When the type guard runs
    Then it returns true and the event narrows to SimulationSetArchivedEvent

  @unit
  Scenario: SimulationSetArchivedEvent rejects payloads missing scenarioRunIds
    Given a candidate event missing the scenarioRunIds field
    When SimulationSetArchivedEventSchema.safeParse runs
    Then parsing fails
