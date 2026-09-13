Feature: Served agent instance on runs
  As a person who reads the results of a run against a connected agent
  I want each run to say which instance of the agent answered it
  So that a difference between two runs can be traced to the process that served them.

  Background: where the instance comes from.
    A connected agent runs as one or more instances, one per process. The
    scenario child learns which instance answered the run from the relay and
    reports it on its result line when it exits. The parent records it on the
    run, in the reserved "langwatch" namespace of the run metadata, under
    "agentInstance" with the instance hostname and its label.

    The run's own finished event comes from the child through the SDK, so the
    instance arrives after it, as its own event. Recording it changes nothing
    else on the run: not its status, not its verdict, not its other metadata.

  @unit
  Scenario: A job that ran to the end records the instance that served it
    Given a child result line that names the instance "worker-1" with the label "blue"
    When the job completes
    Then the run records the agent instance "worker-1" with the label "blue"

  @unit
  Scenario: A job served by no connected agent records nothing
    Given a child result line that names no instance
    When the job completes
    Then nothing is recorded on the run

  @unit
  Scenario: The instance is written into the run metadata beside what the run already carries
    Given a run whose metadata carries the target key and the resolved models
    When the instance "worker-1" is recorded
    Then the metadata still carries the target key and the models
    And "langwatch.agentInstance" reads "worker-1" with its label

  @unit
  Scenario: Recording the instance after the run finished keeps the run finished
    Given a run that finished with the verdict "success"
    When the instance is recorded
    Then the run keeps its status, its verdict and its finish time

  # The parent stamps the record with the wall clock after the child exits, so
  # its business time can land after the finished event's, and the fold can
  # process the record first. The finished event then reads as out of order
  # and re-folds the run from the event log, which may not return the finished
  # event yet. Three production runs stayed IN_PROGRESS this way.
  @unit
  Scenario: A finished event folded after the instance record still finishes the run
    Given a run whose instance was recorded 100 ms after its finished event's time
    And the fold has folded the record but not the finished event
    And the event log read does not return the finished event yet
    When the finished event is folded
    Then the run reads SUCCESS with its verdict and its finish time
    And the metadata keeps the instance

  @integration
  Scenario: A finished run stores the instance that served it
    Given a run that was queued, finished and had its instance recorded
    When the run is stored and read back
    Then its metadata carries the instance under the reserved langwatch namespace
    And the metadata still parses as the platform's reserved namespace

  @integration
  Scenario: The processor records the instance off the child's result line
    Given a scenario child that writes log lines and then a result line naming the instance "worker-1"
    When the processor runs the job and the child exits
    Then the run records the agent instance "worker-1"
    And a child whose result line names no instance records nothing
