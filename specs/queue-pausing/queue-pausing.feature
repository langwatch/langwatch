Feature: Queue pipeline pausing
  As an operator using Skynet
  I want to pause and unpause pipeline processing
  So that I can control job execution during incidents or maintenance

  Scenario: Pause a pipeline stops job dispatch
    Given a pipeline is actively processing jobs
    When an operator pauses the pipeline via Skynet
    Then new jobs for that pipeline are not dispatched
    And already-dispatched jobs continue to completion

  Scenario: Unpause a pipeline resumes job dispatch
    Given a pipeline has been paused
    And there are pending jobs waiting for dispatch
    When an operator unpauses the pipeline via Skynet
    Then pending jobs resume dispatching

  Scenario: Pause at pipeline level pauses all job types
    Given a pipeline has multiple job types processing
    When an operator pauses at the pipeline level
    Then all job types within that pipeline stop dispatching

  Scenario: Pause at job-type level only pauses that type
    Given a pipeline has multiple job types processing
    When an operator pauses a specific job type
    Then only that job type stops dispatching
    And other job types in the same pipeline continue normally

  Scenario: Paused jobs stay in staging until unpaused
    Given a pipeline is paused
    When jobs are queued for the paused pipeline
    Then those jobs are not dispatched
    And when the pipeline is unpaused, the queued jobs dispatch immediately

  # ============================================================================
  # Per-tenant pause — added 2026-05-11 post-incident
  # ============================================================================
  # During the W_7kPya event-sourcing outage we wished we could pause ALL
  # processing for one tenant without affecting other tenants. The existing
  # pause is per-pipeline-key (e.g. "trace_processing", or
  # "trace_processing/command/recordSpan"). It cannot scope by tenant.
  #
  # The dispatch Lua extracts the tenantId from the groupId prefix
  # (everything before the first "/"). If `<keyPrefix>paused-tenants` SET
  # contains that tenantId, the group is skipped this scan (same skip as
  # pipeline pauses — group remains in staging and re-checks next scan).

  @integration @v1 @tenant-pause
  Scenario: Pausing a tenant halts dispatch for that tenant only
    Given two tenants A and B both with pending groups
    When an operator pauses tenant A
    Then no further groups for tenant A are dispatched
    And tenant B's groups continue dispatching normally

  @integration @v1 @tenant-pause
  Scenario: Unpausing a tenant resumes dispatch immediately
    Given tenant A is paused and has pending groups
    When the operator unpauses tenant A
    Then tenant A's groups resume dispatching within the next scan

  # ============================================================================
  # Pause must not block OTHER tenants — added 2026-05-27 post-incident
  # ============================================================================
  # A paused tenant can hold a very large due-now backlog. The dispatcher scans
  # the shared ready queue with a bounded budget per poll; if a huge paused
  # backlog sits at the front, the scan exhausts its budget skipping it and never
  # reaches other tenants. So a paused tenant's groups are held out of the
  # dispatch scan entirely (not skipped in place), and restored when unpaused.

  @integration @v1 @tenant-pause
  Scenario: A paused tenant's backlog does not block other tenants
    Given tenant A is paused with many pending groups at the front of the queue
    And tenant B has a pending group behind them
    When the dispatcher runs
    Then tenant B's group is dispatched
    And tenant A's groups are held out of the dispatch scan

  @integration @v1 @tenant-pause
  Scenario: A still-paused tenant is not restored by the reconcile
    Given tenant A is paused and its groups are held out of the dispatch scan
    When the dispatcher reconcile runs while tenant A is still paused
    Then tenant A's groups remain held out of the scan

  # Note: scenarios "active jobs at pause-time complete normally" and
  # "Ops UI controls" are covered by integration tests + manual QA below
  # and are not added as separate @scenario-bound unit tests because the
  # Lua dispatch path and React UI rendering are exercised in higher-level
  # suites (integration + manual browser QA captured in the PR description).
