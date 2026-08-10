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
    And the value exceeds the production GroupQueue drain budget of 20 seconds

  @regression @helm-grace-period
  Scenario: Operators can raise the grace period for a slower drain
    Given a values override setting workers.terminationGracePeriodSeconds
    When the workers Deployment is rendered
    Then it uses the overridden value
