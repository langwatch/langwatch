Feature: The worker hosts the simulation processing pipeline
  Every simulation run LangWatch executes is folded by the simulation
  processing pipeline. A worker that claims fewer of its routing keys does not
  degrade: the queue keeps redelivering the jobs nothing claimed, forever.

  The worker does not assemble this pipeline by hand. It installs the scenario
  module, and createApp builds the module's declared pipeline for the worker
  role: the folds, the subscribers and the process managers run where the
  queue drains, and the api only sends commands.

  What a customer notices is only ever the absence: a run stuck at queued, a
  suite that never completes, a simulation whose cost and latency never arrive.

  Background:
    Given a process that installs the scenario module over memory stores

  Rule: Every routing key the pipeline declares is claimed on the worker

    @unit
    Scenario: The worker hosts every simulation processing routing key
      When the process boots in the worker role
      Then it claims every command, fold, map, subscriber and process manager key simulation processing declares
      And no key under simulation processing is claimed that the pipeline does not declare

  Rule: A run's progress reaches whoever is watching it

    @unit
    Scenario: The worker hosts the subscriber that tells a tenant's tabs a run changed
      When the process boots in the worker role
      Then the snapshot broadcast subscriber is among the keys it claims

    @unit
    Scenario: The worker hosts the subscriber that reports a run into its suite run
      When the process boots in the worker role
      Then the suite run sync subscriber is among the keys it claims

  Rule: The run executes where the queue drains

    @unit
    Scenario: The worker runs the run-execution process manager itself
      When the process boots in the worker role
      Then no simulation process manager is left unrun

    @unit
    Scenario: The api registers the run-execution process manager without running it
      When the process boots in the api role
      Then the run-execution process manager is named among those it will not run

    @unit
    Scenario: A worker missing one execution input composes no executor
      Given a worker whose deployment states no ingestion endpoint for a child
      When it resolves whether it can execute simulations
      Then it composes no executor and names the missing input
