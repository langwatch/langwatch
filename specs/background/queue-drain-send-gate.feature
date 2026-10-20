Feature: A queue drain accepts the work it is producing

  When a worker pod receives SIGTERM the group queue stops claiming new jobs
  and drains the ones it holds. Those jobs are not inert while they finish:
  they store events and dispatch them onward. The queue must accept that
  fan-out, because it is the work the drain exists to complete.

  # Why this exists — 2026-08-24 prod
  #
  # Every worker rollout shed a burst of "Failed to dispatch event to
  # subscriber queue", all carrying the same cause:
  #
  #   Cannot send to queue after shutdown has been requested
  #
  # 1,185 of them across two deploys in one morning, ~200 more on the next,
  # and none outside a rollout window.
  #
  # There is ONE global group queue. The projection, subscriber, map and fold
  # "queues" are facades over it, so close() set shutdownRequested on the very
  # queue it was about to drain, and send() refused from that instant. A job
  # still in flight stored its events, dispatched them onward, and the queue
  # rejected the work its own drain was producing.
  #
  # Nothing above retried it. The projection router collects the failure, the
  # event-sourcing service catches the AggregateError and carries on, so the
  # job SUCCEEDS while its projections never see those events. The events are
  # durable in the event store; the projections built from them quietly skip a
  # rollout's worth, and nothing reports a gap.
  #
  # Refusing was never protecting anything. send() stages into Redis over
  # redisConnection, and the drain does not close it — only the blocking
  # connection goes, and the shared connections are closed afterwards by
  # App.close, once the drain has finished. Staged work is durable and shared,
  # so a job staged during a drain is picked up by another pod. Throwing turned
  # work that would have survived into work that was lost.
  #
  # The gate belongs at the END of the drain, not the start of it.

  @unit @drain-send-gate
  Scenario: Work produced by an in-flight job during the drain is still staged
    Given a queue that has begun draining
    When a job still in flight stages downstream work
    Then the work is staged rather than refused
    So that a drain cannot destroy the work it exists to finish

  @unit @drain-send-gate
  Scenario: Batched work produced during the drain is also staged
    Given a queue that has begun draining
    When a job still in flight stages a batch of downstream work
    Then the batch is staged rather than refused

  @unit @drain-send-gate
  Scenario: Staging is refused once the drain is over
    Given a queue whose drain has finished
    When anything tries to stage more work
    Then it is refused, naming shutdown as the reason
    So that nothing stages into transports that are about to go

  @unit @drain-send-gate
  Scenario: A drain that overran its budget still closes the gate
    Given a queue whose drain overran its budget and was abandoned
    When anything tries to stage more work
    Then it is refused
    So that the gate does not depend on the drain ending well

  @unit @drain-send-gate
  Scenario: The dispatcher stops claiming new jobs as soon as shutdown starts
    Given a queue that has begun draining
    Then it claims no further jobs
    So that accepting the fan-out finishes in-flight work without starting more

  # The gate is per processor, and the producer is its own processor
  #
  # 2026-10-20 prod: every worker rollout logged a burst of
  #
  #   Cannot send to queue after its drain has finished
  #
  # from the projection router (1,689 in the ten minutes of one rollout), with
  # its siblings "Event subscriber dispatch failed", "Failed to dispatch event
  # to subscriber queue" and "Failed to dispatch batch of events to map/fold
  # projection queue".
  #
  # The gate above was right for one processor that both stages and consumes.
  # The capability split gave the eventing queue a producer processor and
  # separate consumer processors, and the adapter closed the PRODUCER FIRST.
  # A producer has no dispatcher and nothing in flight, so its close finished
  # at once and closed its gate, and only then did the consumers start
  # draining. Every job still in flight sent its fan-out into a producer whose
  # "drain" had already finished.
  #
  # The fix is the order: consumers drain first, the producer closes after
  # them. What is left is a consumer drain that overran its budget and was
  # abandoned: that job is still running, and its sends are refused. Each such
  # refusal is already kept for re-drive (a hand-off, or a fold job that fails
  # and retries), so the log line is a warning that names the reason, not a
  # platform error. Every other dispatch failure is still an error.
  #
  # The stores (Prisma, Redis, ClickHouse) close after the queue drain; that
  # order is pinned in worker-graceful-shutdown.feature ("The queue drain
  # completes before any connection is closed").

  @integration @drain-send-gate
  Scenario: A job still draining at shutdown stages its fan-out through the same queue
    Given an eventing queue whose consumer holds a job that is still running
    When the queue closes
    And the job then stages downstream work on the same queue
    Then the work is staged rather than refused
    So that a rollout cannot drop the fan-out of the work it is draining

  @unit @drain-send-gate
  Scenario: The producer closes only after every consumer has drained
    Given an eventing queue with a consumer that is still draining
    When the queue closes
    Then the producer is not closed until the consumer's drain has finished
    And a consumer drain that fails still closes the producer

  @unit @drain-send-gate
  Scenario: A dispatch refused because the drain already ended is a warning
    Given a queue whose drain has finished during shutdown
    When the projection router dispatches events to it
    Then the refusal is logged at warning level with the reason
    And the events are still kept for re-drive

  @unit @drain-send-gate
  Scenario: Any other dispatch failure is still an error
    Given a queue that refuses a dispatch for any other reason
    When the projection router dispatches events to it
    Then the failure is logged at error level
