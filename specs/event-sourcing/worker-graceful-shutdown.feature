Feature: Worker graceful shutdown does not sever in-flight ClickHouse work

  When a worker pod receives SIGTERM — every deploy rollout, every node
  eviction, every scale-down — it must finish or safely re-stage the work it
  is holding before its connections go away. Today it does not, and the
  evidence is in production.

  # Why this exists — 2026-08-10 prod alert
  #
  # Three "New Error Signature" alerts fired together at 16:52 UTC. All three
  # were the same event rendered by different ClickHouse loggers:
  #
  #   Code: 210. DB::Exception: I/O error: Broken pipe, while writing to
  #   socket (...): While executing ParallelFormattingOutputFormat.
  #   (NETWORK_ERROR)
  #
  # ClickHouse was mid-response to a client that had already gone. The mirror
  # image appeared on the worker side as `socket hang up` against inserts,
  # event-store writes and canonical log/metric persistence. The bursts line
  # up exactly with worker pods terminating: image rollouts at ~11:30 and
  # ~16:50, and a node-eviction wave at 14:20-14:30. Immediately before the
  # 16:50 rollout ClickHouse held ~200 statements in flight with ~1000 more
  # queued behind the concurrency cap; all of it was severed at once.
  #
  # The cause is an ordering defect, not a timeout. App.close() ran
  # `Promise.allSettled([_eventSourcing.close(), ...gracefulCloseables])`, so
  # the ClickHouse client was destroyed CONCURRENTLY with the GroupQueue
  # drain it was still serving. The drain has a 20s budget in production and
  # was reliably outlived by a close that took milliseconds.
  #
  # Two consequences, both fixed here:
  #   1. The abort itself — in-flight statements killed rather than drained.
  #   2. The classification of the resulting error. `socket hang up` carries
  #      `code: "ECONNRESET"`, which is not a numeric ClickHouse code and
  #      matches no transient message fragment, so classifyClickHouseError
  #      returned CRITICAL. isRetryableJobError treats CRITICAL as
  #      non-retryable, so suite/simulation/experiment run-state jobs were
  #      dead-lettered and their groups blocked instead of retried.

  # One budget, four nested clocks
  #
  # Four clocks run during termination and they are nested, not parallel:
  #
  #   terminationGracePeriodSeconds   kubelet SIGKILL      (charts/langwatch)
  #   └─ processDeadlineMs            force-exit watchdog  (start.ts, workers.ts)
  #      └─ appCloseMs                App.close backstop   (app-layer/app.ts)
  #         └─ queueDrainMs           GroupQueueProcessor  (groupQueue.ts)
  #
  # They were four independent literals in four files, agreeing only by
  # comment — and they did not agree: start.ts force-exited after 5s, inside
  # the queue's own 20s drain budget, so the `all` process role (the app
  # hosting the worker stack) could never finish a drain however long the
  # queue was told it had. They are now derived from one number.

  @unit @shutdown-budget
  Scenario: Every shutdown clock nests inside the one outside it
    Given any configured drain budget
    When the shutdown clocks are derived from it
    Then each clock finishes inside the one outside it
    So that no outer clock can fire while the work it protects is still running

  @unit @shutdown-budget
  Scenario: Raising the drain budget widens every clock above it
    Given an operator raises the drain budget
    When the shutdown clocks are derived
    Then every clock above it widens by the same amount
    So that granting a longer drain never needs a second edit to stay consistent

  @unit @shutdown-budget
  Scenario: The required grace period matches what the chart guard enforces
    Given the derived shutdown budget
    When it is compared with the margin the chart and its test suite apply
    Then all three agree
    So that retuning one alone cannot admit a release the kubelet kills mid-drain

  @unit @shutdown-budget
  Scenario: The drain budget defaults to 25s in production and 5s in dev
    Given no configured override
    When the shutdown budget is resolved
    Then production drains for 25 seconds
    And a development or local environment drains for 5 seconds

  @unit @shutdown-budget
  Scenario: The chart is sized for the same production drain the code uses
    Given the resolved production drain budget
    When it is compared with the drain the chart and its suite declare
    Then all of them agree
    So that the pod cannot be sized for a budget the process no longer uses

  @unit @shutdown-budget
  Scenario: A malformed drain override is reported and falls back, never fatal
    Given the configured drain budget is not a positive number of milliseconds
    When the shutdown budget is resolved
    Then the process reports the bad value and keeps a working budget
    So that one mistyped character cannot crashloop a whole fleet

  # One shutdown implementation, shared by both entrypoints

  @unit @shutdown-runner
  Scenario: Shutdown phases run in order, never concurrently
    Given a shutdown with several teardown phases
    When it runs
    Then each phase completes before the next begins
    And the process exits zero

  @unit @shutdown-runner
  Scenario: A failing phase does not skip the phases after it
    Given a shutdown whose first phase throws
    When it runs
    Then the failure is logged against that phase name
    And the remaining phases still run

  @unit @shutdown-runner
  Scenario: A shutdown that overruns its deadline exits on its own terms
    Given a shutdown phase that never finishes
    When the deadline passes
    Then the process exits non-zero with a log line explaining the overrun

  # A phase that never settles takes the whole shutdown with it, including the
  # drain that is the point of the exercise. The live example: closing the
  # websocket server resolves only once every client has gone, and one
  # suspended laptop tab holds that open indefinitely.
  @unit @shutdown-runner
  Scenario: A phase that hangs is abandoned so the rest still run
    Given a shutdown whose first phase never finishes
    When that phase outlasts its own budget
    Then it is abandoned and logged
    And the later phases, including the queue drain, still run

  # Closing the listener is not the same as ending the connections on it. The
  # first cut destroyed every socket outright, which turned each rolling deploy
  # into a burst of 502s for whatever was mid-request; the cut after that put
  # the destroy behind a wait that a stuck stream never ended, so it never ran
  # and the phase timed out on every deploy instead.

  @unit @shutdown-http
  Scenario: A request in flight when the listener closes is allowed to finish
    Given a connection that finishes inside the drain grace
    When the http server phase runs
    Then the connection is never destroyed
    And the phase completes on its own

  @unit @shutdown-http
  Scenario: A connection outliving the grace is destroyed inside the phase
    Given a connection that never ends on its own
    When the drain grace passes
    Then the leftover connections are destroyed and the reason is logged
    And the phase completes rather than being abandoned

  @unit @shutdown-http
  Scenario: The drain grace is spent on requests, not on session teardown
    Given extra session teardown that takes its own time
    When the http server phase runs
    Then the teardown does not come out of the grace in-flight requests were given

  @unit @shutdown-http
  Scenario: Session teardown that fails still leaves the connections reaped
    Given extra session teardown that throws
    When the http server phase runs
    Then the failure is logged
    And the leftover connections are still destroyed

  @unit @shutdown-http
  Scenario: The phase outwaits its own drain grace
    Given the shutdown budget
    Then the http phase ceiling is longer than the grace it hands out
    So that the runner never abandons the phase before the destroy it exists to perform

  @unit @shutdown-runner
  Scenario: A second signal during shutdown does not start a second teardown
    Given a shutdown already running from SIGTERM
    When an operator adds a Ctrl-C on top
    Then the sequence still runs exactly once

  # Telemetry participates in the shutdown; it does not own it
  #
  # Node runs EVERY listener registered for a signal, so a telemetry provider
  # that handles SIGTERM itself is racing the shutdown rather than taking part
  # in it — and one that then calls process.exit() does not race it, it wins.
  #
  # Two did. The metrics MeterProvider registered SIGTERM/SIGINT for a
  # best-effort flush, its own comment conceding it was racing the exit. Worse,
  # the `langwatch` SDK's setupObservability() registers SIGTERM/SIGINT BY
  # DEFAULT and calls process.exit(0) the moment its OTel flush resolves — a
  # second or two into a shutdown, killing a drain entitled to the full 25s.
  # The platform now constructs the SDK with disableAutoShutdown and registers
  # both flushes as shutdown phases instead.

  @unit @shutdown-runner
  Scenario: Telemetry flushes after the work, and never ends the process itself
    Given a registered telemetry flush
    When a shutdown runs
    Then the flush runs after every other phase
    And the process is exited exactly once, by the shutdown runner

  @unit @shutdown-runner
  Scenario: A failing telemetry flush does not fail the shutdown
    Given a telemetry flush that throws
    When a shutdown runs
    Then the failure is logged against that flush
    And the process still exits zero

  # Shutdown ordering

  @unit @shutdown-ordering
  Scenario: The queue drain completes before any connection is closed
    Given an App with an event-sourcing consumer and ClickHouse, Redis and Prisma closeables
    When the App is closed
    Then the event-sourcing consumer finishes draining first
    And only then are the ClickHouse, Redis and Prisma connections closed

  @unit @shutdown-ordering
  Scenario: A failing drain still releases the connections
    Given an App whose event-sourcing consumer throws while draining
    When the App is closed
    Then the failure is logged
    And the ClickHouse, Redis and Prisma connections are still closed

  @unit @shutdown-ordering
  Scenario: A hung drain cannot hold the process open forever
    Given an App whose event-sourcing consumer never finishes draining
    And the process is terminating
    When the App is closed
    Then the close gives up on the drain after a bounded wait
    But it leaves the connections alone, because that drain is still running
    So that giving up never becomes the severing it exists to prevent

  @unit @shutdown-ordering
  Scenario: A hung drain in a process that is not terminating still releases its handles
    Given an App whose event-sourcing consumer never finishes draining
    And the process is staying up, as when tests reset the App between files
    When the App is closed
    Then the connections are closed anyway
    So that nothing else has to reclaim handles no dying process will free

  # The projection registry must outlive the queue that feeds it
  #
  # 2026-08-17: `EventSourcing.close()` closed the projection registry BEFORE
  # the global queue. Closing the registry only releases its router, and every
  # dispatch arriving afterwards drops its events — the guard logs and RETURNS,
  # nothing is thrown, and the one caller (`eventSourcingService`) catches the
  # dispatch failure and carries on. Two swallowing layers in a row, nothing
  # above either to retry.
  #
  # But the queue closed LAST, so for the whole length of the drain the workers
  # were still processing jobs and still storing events — into a registry that
  # had already let go of its router. Every one of the 55 dropped batches in the
  # 48h to 2026-08-17 landed after its own pod's SIGTERM (55 of 55, zero before
  # initialize), the latest 26 seconds into the drain.
  #
  # It read as a startup race for five days because the log line said "called
  # before initialize()" and named only the half that never actually happens.
  #
  # Ordering is the whole fix, and it is free: `QueueManager.close()` is a no-op
  # for the globally-owned queue, so the registry's close releases nothing the
  # queue still needs.

  @unit @shutdown-ordering
  Scenario: The projection registry is closed after the queue that feeds it
    Given an event-sourcing instance with an initialized projection registry
    When it is closed
    Then the global queue is closed before the projection registry
    So that work still draining cannot dispatch into a released router

  @unit @shutdown-ordering
  Scenario: A dispatch arriving after the router is gone is still reported
    Given a projection registry that has already closed
    When events are dispatched to it
    Then the loss is logged at error level with the event count
    And the record does not blame initialization alone

  # Error classification — the shutdown abort must be retryable

  @unit @socket-classification
  Scenario: A socket hang up is recoverable, not a data-integrity failure
    Given a ClickHouse call fails with "socket hang up" carrying code ECONNRESET
    When the error is classified
    Then it is categorised RECOVERABLE
    And the job is re-staged with backoff rather than dead-lettered

  @unit @socket-classification
  Scenario Outline: Socket-level failures are recoverable whatever the errno
    Given a ClickHouse call fails carrying code <code>
    When the error is classified
    Then it is categorised RECOVERABLE

    Examples:
      | code          |
      | ECONNRESET    |
      | ECONNREFUSED  |
      | EPIPE         |
      | ETIMEDOUT     |
      | EHOSTUNREACH  |
      | ENETUNREACH   |
      | EAI_AGAIN     |

  @unit @socket-classification
  Scenario: A socket failure that survived only as a message is still recoverable
    Given a ClickHouse call fails with the bare message "socket hang up" and no code
    When the error is classified
    Then it is categorised RECOVERABLE

  @unit @socket-classification
  Scenario: The queue classifier agrees with the ClickHouse client's classifier
    Given the socket-level codes the shared ClickHouse client retries on
    When the event-sourcing classifier is asked about each of them
    Then every one is categorised RECOVERABLE

  @unit @socket-classification
  Scenario: A genuine data error is still critical
    Given a ClickHouse call fails with an unknown-table or type-mismatch error
    When the error is classified
    Then it is categorised CRITICAL
    And the job is not retried

  # Kubernetes must allow the drain to finish

  @regression @helm-grace-period
  Scenario: The workers pod gets long enough to drain
    Given the workers Deployment is rendered
    Then it sets terminationGracePeriodSeconds
    And the value covers the drain budget plus thirty seconds

  @regression @helm-grace-period
  Scenario: The app pod gets the same budget as the workers
    Given the app Deployment is rendered
    Then it sets terminationGracePeriodSeconds
    And the value covers the drain budget plus thirty seconds

  @regression @helm-grace-period
  Scenario: The process is told the same drain budget the pod is sized for
    Given the app and workers Deployments are rendered
    Then each sets SHUTDOWN_DRAIN_TIMEOUT_MS from its own shutdownDrainSeconds
    And raising shutdownDrainSeconds raises the variable with it

  @regression @helm-grace-period
  Scenario: Operators can raise the grace period for a slower drain
    Given a values override setting workers.terminationGracePeriodSeconds
    When the workers Deployment is rendered
    Then it uses the overridden value

  @regression @helm-grace-period
  Scenario: A grace period too short for the drain refuses to render
    Given workers.terminationGracePeriodSeconds is set below the drain budget plus thirty
    When the chart is rendered
    Then the render fails naming both the granted and the required value

  @regression @helm-grace-period
  Scenario: A drain budget that is not a positive whole number refuses to render
    Given a drain budget that is fractional, non-numeric, zero or negative
    When the chart is rendered
    Then it refuses, naming the value
    So that a silently zeroed budget cannot ship a crashlooping release

  @regression @helm-grace-period
  Scenario: The drain budget cannot be overridden behind the pod's back
    Given extraEnvs setting the drain budget directly
    When the chart is rendered
    Then it refuses and points at shutdownDrainSeconds
    So that the process budget and the pod's grace period cannot disagree

  @regression @helm-grace-period
  Scenario: Raising the drain budget alone refuses to render
    Given workers.shutdownDrainSeconds is raised without raising the grace period
    When the chart is rendered
    Then the render fails, so the two numbers cannot drift apart
