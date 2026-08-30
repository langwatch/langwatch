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

  @integration
  Scenario: A finished run stores the instance that served it
    Given a run that was queued, finished and had its instance recorded
    When the run is stored and read back
    Then its metadata carries the instance under the reserved langwatch namespace
    And the metadata still parses as the platform's reserved namespace
