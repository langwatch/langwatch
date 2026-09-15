Feature: A simulation run reports its true state and never leaks secrets

  A run whose prefetch fails must read as failed, not as stuck running; a
  batch must stop reading as running the moment its last run finishes; and
  a run's transcript must never carry the secrets it was configured with.

  # simulation-run-metrics.projection.ts, scenario-prefetch-completion.service.ts,
  # scenario-target-prefetch.service.ts, scenario-execution-lookup.service.ts,
  # scenario-run-secrets.service.ts, scenario-prefetch-failure.rules.ts,
  # suite-run-sync.subscriber.ts, snapshot-update-broadcast.subscriber.ts

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
