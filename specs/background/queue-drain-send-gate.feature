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
