Feature: Boot-time orphan reconciliation, kept as a cutover drain

  A simulation run whose worker died before it could write a terminal event sits
  non-terminal forever: the UI spins at "Starting" or "Running" and nothing
  downstream ever fires. Two cross-tenant ClickHouse sweeps used to be the fix,
  one for runs abandoned at QUEUED and one for runs abandoned at IN_PROGRESS.

  # THIS FILE HAS AN EXPIRY DATE, AND SO DOES THE CODE IT SPECIFIES.
  #
  # ADR-073 replaced these sweeps as the mechanism: the `scenarioExecution`
  # process manager re-arms a durable deadline on every progress event and
  # writes the terminal state itself when one fires, so recovery is bounded by
  # a deadline instead of by deploy cadence. See
  # dev/docs/adr/073-run-execution-on-process-manager.md and
  # specs/scenarios/scenario-execution-process-manager.feature, which owns the
  # ongoing guarantee.
  #
  # The sweeps still run once per boot, for exactly one population: runs that
  # were already stuck when the process manager deployed. It arms deadlines
  # from live events only — it does not replay history, so those runs have no
  # heartbeat and nothing that would ever terminalise them. They are a DRAIN,
  # not the mechanism (scenario.processor.ts, "CUTOVER AID" block).
  #
  # One release after ADR-073 ships, no run predating it can still be open. At
  # that point the drain, the three modules behind it, and THIS FILE are all
  # deleted together. It exists so the removal has something to check itself
  # against — the behaviour is live, tested and shipping, and was left
  # unspecified when the original two feature files were deleted with the
  # graceful-drain scenarios that genuinely had become obsolete.

  Rule: a run only counts as orphaned once it has been silent past the threshold

    @unit
    Scenario: a queued run silent past the threshold is orphaned
      Given a run is still QUEUED
      And its last event is older than the orphan threshold
      When the drain examines it
      Then it is treated as orphaned

    @unit
    Scenario: the threshold boundary itself counts as orphaned
      Given a run is still QUEUED
      And its last event is exactly at the orphan threshold
      When the drain examines it
      Then it is treated as orphaned

    @unit
    Scenario: a recently queued run is left alone
      Given a run is still QUEUED
      And it was queued more recently than the orphan threshold
      When the drain examines it
      Then it is not treated as orphaned

    @unit
    Scenario: a run that is no longer queued is left alone
      Given a run whose status is not QUEUED
      And its last event is older than the orphan threshold
      When the drain examines it
      Then it is not treated as orphaned

  Rule: the drain terminalises what it finds and survives its own failures

    @unit
    Scenario: only the long-abandoned queued run is failed
      Given candidates with mixed status and age
      When the drain reconciles them
      Then a terminal failure is emitted only for the long-abandoned queued run

    @unit
    Scenario: one failing emit does not abandon the remaining orphans
      Given several orphaned runs
      And emitting the failure for one of them rejects
      When the drain reconciles them
      Then the remaining orphans are still processed
      And the failure is counted rather than swallowed

    @unit
    Scenario: a boot with nothing stuck does nothing
      Given there are no candidates
      When the drain reconciles them
      Then nothing is emitted
      And the counts are zero
