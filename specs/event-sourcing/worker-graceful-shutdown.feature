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
    Given any drain budget
    When the shutdown clocks are derived from it
    Then the queue drain is shorter than the App.close backstop
    And the App.close backstop is shorter than the process deadline
    And the process deadline is shorter than the required grace period

  @unit @shutdown-budget
  Scenario: Raising the drain budget widens every clock above it
    Given the drain budget is raised
    When the shutdown clocks are derived
    Then the App.close backstop, the process deadline and the required grace period all move with it

  @unit @shutdown-budget
  Scenario: The required grace period matches what the chart guard enforces
    Given the derived shutdown budget
    Then the required grace period is the drain plus thirty seconds
    And that is the same margin the Helm guard validates against

  @unit @shutdown-budget
  Scenario: The drain budget defaults to 25s in production and 5s in dev
    Given no SHUTDOWN_DRAIN_TIMEOUT_MS override
    When the shutdown budget is resolved
    Then production gets 25 seconds
    And a development or local environment gets 5 seconds

  @unit @shutdown-budget
  Scenario: A malformed drain override is refused, not silently defaulted
    Given SHUTDOWN_DRAIN_TIMEOUT_MS is set to something that is not a positive number
    When the shutdown budget is resolved
    Then resolution fails with an error naming the variable

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
    When the App is closed
    Then the close gives up on the drain after a bounded wait
    And the ClickHouse, Redis and Prisma connections are still closed

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
  Scenario: Raising the drain budget alone refuses to render
    Given workers.shutdownDrainSeconds is raised without raising the grace period
    When the chart is rendered
    Then the render fails, so the two numbers cannot drift apart
