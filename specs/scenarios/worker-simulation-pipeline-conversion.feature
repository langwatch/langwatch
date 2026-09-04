Feature: The worker mounts the simulation processing pipeline
  Every simulation run LangWatch executes is folded by the simulation
  processing pipeline, and the frozen job registry lists sixteen routing keys
  for it. A worker process that registers fewer does not degrade: the queue
  keeps redelivering the jobs nothing claimed, forever.

  Until now the standalone worker could only re-register a definition the
  application had already built and bound. This feature is about the worker
  building it: its own run-state fold over ClickHouse, its own metrics command
  over the trace summary this process already folds, its own run-execution
  process manager, and its own deferred metrics retry.

  What a customer notices is only ever the absence: a run stuck at queued, a
  suite that never completes, a simulation whose cost and latency never arrive.

  Background:
    Given a worker process holding one queue, one ClickHouse client and the trace summary fold
    And the simulation pipeline composed from packages alone

  Rule: Every routing key the registry lists is claimed

    @unit
    Scenario: The worker mounts every simulation routing key
      Given the byte-frozen job registry's sixteen simulation processing keys
      When the worker builds its simulation pipeline
      Then every key is claimed but the deferred retry the feature installer owns
      And no key is registered that the registry does not list
      And the pipeline is named the way the queue routes it

  Rule: A run's progress reaches whoever is watching it

    @unit
    Scenario: A simulation snapshot reaches the tenant's own tabs
      Given a message snapshot on a running simulation
      When the snapshot subscriber runs
      Then it publishes through the one tenant bridge this process composed
      And the payload is addressed to the simulation channel

    @unit
    Scenario: A simulation run reports into its suite run
      Given a simulation run started inside a suite
      When the suite sync subscriber runs
      Then the item start is recorded through the suite feature's own command

  Rule: A capability this process cannot compose is declared, never guessed

    @unit
    Scenario: A worker without an execution pool says so at boot
      Given a worker that composes no scenario execution pool
      When it composes the simulation pipeline
      Then the absence is reported by name
      And a queued run is refused into the outbox rather than dropped

  Rule: A worker that composed an executor runs the run itself

    @unit
    Scenario: A worker holding an execution pool starts a queued run
      Given a worker that composed a scenario execution pool
      When the run-execution process manager dispatches its execute intent
      Then the run is submitted to this process's own pool
      And no absence is reported at boot

    @unit
    Scenario: A worker missing one execution input composes no executor
      Given a worker whose deployment states no ingestion endpoint for a child
      When it resolves whether it can execute simulations
      Then it composes no executor and names the missing input
