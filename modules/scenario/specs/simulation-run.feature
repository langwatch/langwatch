Feature: A simulation run reports its true state and never leaks secrets

  A run whose prefetch fails must read as failed, not as stuck running; a
  batch must stop reading as running the moment its last run finishes; and
  a run's transcript must never carry the secrets it was configured with.

  # simulation-run-metrics.projection.ts, scenario-prefetch-completion.service.ts,
  # scenario-target-prefetch.service.ts, scenario-execution-lookup.service.ts,
  # scenario-run-secrets.service.ts, scenario-prefetch-failure.rules.ts,
  # snapshot-update-broadcast.subscriber.ts (suite progress: suite-progress-from-scenario-facts.feature)

  @unit @unimplemented
  Scenario: A run whose prefetch fails is reported failed, not left running
    Given a simulation run whose target prefetch fails
    When the failure is handled
    Then the run reads as failed with the reason, not as still running

  @unit @unimplemented
  Scenario: A batch shows as running only while one of its runs is running
    Given a batch whose every run has finished
    When the batch is read
    Then it does not read as running

  @unit @unimplemented
  Scenario: Secrets a run needs never appear in its stored transcript
    Given a run configured with a provider secret
    When the run's transcript is stored
    Then the secret value appears nowhere in it

  @unit @unimplemented
  Scenario: A duplicate run-completion event does not double the batch's metrics
    Given a run completion already folded into the batch metrics
    When the same completion is replayed
    Then the metrics are unchanged

  # NO-HOLDS (ARCHITECTURE.md section 7): head's api serves while goose 00101 is still pending.
  @unit
  Scenario: A run read before the per-criterion columns exist answers no per-criterion verdicts
    Given the ClickHouse target has no `Criteria.*` columns on simulation_runs yet
    When a run is read by id or listed
    Then the read selects empty per-criterion arrays under the column names instead of failing

  @unit
  Scenario: A run read once the per-criterion columns exist answers the stored verdicts
    Given the ClickHouse target has the `Criteria.*` columns on simulation_runs
    When a run is read by id or listed
    Then the read selects the stored per-criterion columns

  @unit
  Scenario: The scenario-set list with no start date is a declared full scan
    Given a tenant's scenario sets run across many weeks
    When the set list is read with no start date
    Then every set the tenant ever ran is listed, as on main, declared a full scan
    And a list read from a start date declares nothing, so the date prunes

  # The read schema tolerates what stored rows and SDK events hold; the event intake stays strict.
  @unit
  Scenario: A run stamped with a target type outside today's set still reads, with no target type
    Given a stored run whose platform namespace names a target type the platform does not know, or none
    When the run is read
    Then the run reads with no target type instead of failing the read
    And the rest of its platform context still reads: target, suite, scenario version, models and who started it

  @unit
  Scenario: A run whose platform context does not otherwise read still reads, with no platform context
    Given a stored run whose platform namespace holds a field that does not read, other than the target type
    When the run is read
    Then the run reads with no platform context instead of failing the read

  @unit
  Scenario: A run stamped with a target type in another case reads as that target
    Given a stored run whose platform namespace names a known target type in upper case
    When the run is read
    Then the run reads as that target
