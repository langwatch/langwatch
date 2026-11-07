Feature: A simulation blocked by the project's own configuration says so

  A simulation run cannot start until its models resolve: the provider has to
  be enabled, the model name has to parse, the credentials have to be there,
  and a model has to be chosen for scenarios at all. When one of those is
  missing the run fails — correctly, and with a message telling the customer
  what to change.

  What it must not do is read as an outage. Those runs were logging at error
  next to genuine platform faults, so the fleet's error stream carried a steady
  trickle of records nobody could act on, and the ones that mattered sat among
  them.

  The rule is the same one the topic-clustering classifier follows: a failure
  is the customer's only when we recognise it as theirs. An unrecognised reason
  stays ours, because telling someone their configuration is broken on the
  strength of not recognising an error is worse than logging one record too
  loudly.

  @unit @scenario-prefetch
  Scenario: A run blocked by a disabled provider is not reported as our failure
    Given a project whose scenario provider is turned off
    When the run's data is prefetched
    Then the run fails with the remediation message
    And the record is logged below error level
    And the record names the reason the run could not start

  @unit @scenario-prefetch
  Scenario: A project with no model chosen for scenarios is the customer's to fix
    Given a project with no default model configured for scenarios
    When the run's data is prefetched
    Then the record is logged below error level
    And the record names the reason the run could not start

  @unit @scenario-prefetch
  Scenario: A project with no model for the simulator gets a run refused with the remediation message, logged as a warning, not an error
    Given a project with no model for the simulator
    When the run's models are resolved
    Then the run is refused with the model-not-configured remediation message
    And the record names the reason "model_not_configured"
    And the record is logged at warn level
    And nothing is logged at error level

  @unit @scenario-prefetch
  Scenario: A project whose only models are restricted for a scenario feature gets the run refused, logged as a warning
    Given a project whose only configured models are restricted for a scenario feature
    When the run's models are resolved
    Then the run is refused with the restriction message
    And the record names the reason "model_not_configured"
    And the record is logged at warn level
    And nothing is logged at error level

  @unit @scenario-child
  Scenario: A child the processor released is logged at info, a child that dies by itself still at error
    Given a scenario child process the processor has released on purpose
    When the child closes because of the SIGTERM the release sent, or exits with a code after trapping it
    Then the close is logged at info level and not at error level
    But a released child that any other signal killed is logged at error level
    And a child that exited before the release could signal it is logged at error level
    And the release closes the child's stdin so a child still reading its job can stop
    And a child stopped by the timeout has its stdin closed too
    And a child that closes without an exit code and was not released is logged at error level

  @unit @scenario-prefetch
  Scenario: A failure we do not recognise stays ours
    Given a prefetch that fails while preparing the run
    When the run's data is prefetched
    Then the record is logged at error level

  @unit @scenario-prefetch
  Scenario: A failure carrying no reason at all stays ours
    Given a prefetch that fails without naming a reason
    When the run's data is prefetched
    Then the record is logged at error level
