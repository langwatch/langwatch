Feature: Group-queue metrics name the pipeline and job behind a stuck or refused job
  As an operator paged by a group-queue alert
  I want the blocked, oldest-pending and non-retryable series to say which pipeline and job they belong to
  So that an alert grouped by queue and job points at the failing job, not only the queue

  # Label values come from the job's routing header (pipeline, job type, job
  # name), the same values gq_jobs_completed_total and the other job counters
  # carry. Tenant ids and aggregate keys never become label values.
  #
  # gq_parked_groups stays per queue: a per-job breakdown would read every
  # parked group each collect cycle, and 443k groups were parked in the
  # 2026-10-15 incident. Parking is visible per tenant in the logs instead.
  #
  # gq_jobs_dropped_total already carries pipeline_name, job_type, job_name and
  # a bounded reason (decode-drop-durability.feature); this file adds nothing to it.

  @integration
  Scenario: A non-retryable failure and its blocked group carry the job's pipeline and job
    Given a queue whose handler throws a non-retryable error
    When a job for pipeline "trace_processing" and job "traceSummary" fails and its group is blocked
    Then gq_jobs_non_retryable_total counts it under that pipeline and job with reason "non_retryable_error"
    And gq_blocked_groups counts the group under that pipeline and job, read on Redis from its head job

  @unit
  Scenario: Blocked groups are counted per pipeline and job
    Given blocked groups whose head jobs belong to two jobs
    When the metrics collector runs a cycle
    Then gq_blocked_groups publishes one series per pipeline and job with that job's group count

  @unit
  Scenario: A cleared job's blocked series drops to zero
    Given a job had blocked groups in the previous cycle
    And all of them have since been unblocked
    When the metrics collector runs a cycle
    Then that job's gq_blocked_groups series reads 0 rather than its last value

  @unit
  Scenario: A blocked group without routing metadata counts as unknown
    Given a blocked group whose head job carries no routing header
    When the metrics collector runs a cycle
    Then it is counted under pipeline, job type and job "unknown"
    And the series still sum to the queue's blocked total

  @unit
  Scenario: Blocked groups beyond the scan cap are counted as unknown
    Given more groups are blocked than one cycle scans
    When the metrics collector runs a cycle
    Then the unscanned remainder is counted under "unknown"
    And the series still sum to the queue's blocked total

  @unit
  Scenario: A failed label lookup or blocked scan does not stop the cycle
    Given the label script or the blocked scan fails
    When the metrics collector runs a cycle
    Then the affected groups are counted under "unknown"
    And the cycle's other gauges still publish

  @unit
  Scenario: The oldest pending age names the oldest group's pipeline and job
    Given the oldest eligible group changes between two cycles
    When the metrics collector runs both cycles
    Then gq_oldest_pending_age_milliseconds reads the new group's age under its pipeline and job
    And the previous group's series reads 0

  @unit
  Scenario: A tenant's park start and stop are each logged once
    Given a tenant whose groups are parked at the in-flight soft cap
    When it stays parked across cycles and is then released
    Then one warning says the tenant started being parked, with its parked group count
    And one info line says it stopped being parked
    And no line is written per parked group

  # gq_group_staging_depth_max cannot name its group (aggregate keys never become
  # label values), so the deepest group is named in a rate-limited log line instead.
  @unit
  Scenario: The deepest staged group over the reporting floor is named in a warning
    Given a staging-depth rotation whose deepest group is over the reporting floor
    When the rotation ends
    Then one warning names that group, its tenant, its depth and whether it is blocked
    And the next rotation inside the rate limit names it no further
