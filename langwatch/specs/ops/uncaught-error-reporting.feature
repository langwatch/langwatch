Feature: Uncaught backend errors are reported to PostHog
  As an operator watching the "users hitting an error per week" quality metric
  I want process-level crashes in the server and worker processes to reach PostHog
  So that the error metric reflects real backend failures, not just client + handled errors

  Context: the global crash handlers in start.ts and workers.ts only called
  logger.fatal and exited, so uncaught exceptions and unhandled promise
  rejections — the most severe, process-killing errors — were written to logs
  but never sent to PostHog. The "the truth" dashboard error tile (insight
  fNE339yg) therefore silently under-reported backend errors. PostHog's
  posthog-node client batches events, so an event captured in a dying process
  is lost unless the buffer is flushed (shutdownPostHog) before exit.

  @integration
  Scenario: An uncaught exception in the server process is captured and flushed before exit
    Given the server process has a configured PostHog client
    When an uncaught exception is thrown
    Then a "$exception" event is captured tagged source=uncaughtException, process=server
    And the PostHog buffer is flushed before the process exits

  @integration
  Scenario: An uncaught exception in a worker process is captured and flushed before exit
    Given a worker process has a configured PostHog client
    When an uncaught exception is thrown
    Then a "$exception" event is captured tagged source=uncaughtException, process=worker
    And the PostHog buffer is flushed as part of graceful shutdown

  @integration
  Scenario: An unhandled rejection is captured without changing exit behavior
    Given the server or worker process has a configured PostHog client
    When a promise rejection goes unhandled
    Then a "$exception" event is captured tagged source=unhandledRejection
    And the process keeps running, relying on the normal batch flush to deliver it

  @unit
  Scenario: Capturing a crash never throws even when PostHog is not configured
    Given no POSTHOG_KEY is set
    When the crash handler captures an error
    Then no error is raised and the shutdown sequence still completes
