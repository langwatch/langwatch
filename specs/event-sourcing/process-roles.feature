Feature: Process roles decide whether a process consumes its own queues

  Every process that boots the event-sourcing runtime can stage work. Only a
  process whose role runs the worker stack consumes it. That is what lets web
  instances scale on request volume while worker instances scale on backlog.

  # The single test is `roleRunsWorkers(role)` (src/server/app-layer/config.ts),
  # never `processRole === "worker"` — "all" is the dev-only single-process role
  # and runs the worker stack too. `roleRunsWorkers` itself is specified and
  # BOUND in specs/setup/in-process-workers-dev.feature; this file owns the
  # runtime consequence, which is a different question.
  #
  # This file replaces an earlier version that asserted "queue workers for
  # reactors are/are not started". The reactor was retired by ADR-075 — post-
  # event work is now an event subscriber, a projection or a process manager —
  # and the earlier file was untagged, so it enforced nothing while reading as
  # green. See dev/docs/adr/075-post-event-work-subscribers-and-process-managers.md.

  Background:
    Given an EventSourcing runtime with pipelines registered

  @unimplemented
  Scenario: a web process stages work without consuming it
    Given the runtime is initialized with the "web" process role
    When a command is dispatched and its events are stored
    Then the events are staged onto the queues
    And no queue consumer runs in this process for projections
    And no queue consumer runs in this process for event subscribers
    And no process-manager outbox or wake worker runs in this process
    And the staged work waits for a process that runs the worker stack

  @unimplemented
  Scenario: a worker process consumes what any process staged
    Given the runtime is initialized with the "worker" process role
    When events staged by another process become available
    Then queue consumers run in this process for fold projections
    And queue consumers run in this process for map projections
    And queue consumers run in this process for event subscribers
    And the process-manager outbox and wake workers run in this process

  @unimplemented
  Scenario: the single-process development role does both
    Given the runtime is initialized with the "all" process role
    When a command is dispatched and its events are stored
    Then the events are staged as they are in a web process
    And the same queue consumers run as in a worker process
    And no second process is needed for background work to happen
