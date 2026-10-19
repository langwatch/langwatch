Feature: A job for a deleted project completes instead of retrying
  As an operator running a LangWatch deployment
  I want work for a project deleted after it was queued to be dropped wherever it runs
  So that a deleted project never blocks a queue group or fills the dead letters with retries that can never succeed

  @unit
  Scenario Outline: A <kind> job whose project no longer exists completes as a no-op
    Given a <kind> job queued for a project that was deleted afterwards
    When the job's handler is refused because the project was not found
    Then the job completes with one warning naming its tenant, queue and job type
    And the queue does not retry it

    Examples:
      | kind            |
      | command         |
      | fold projection |
      | map projection  |
      | subscriber      |
      | process manager |

  @unit
  Scenario: A coalesced batch whose project no longer exists completes as a no-op
    Given a coalesced batch of jobs for a project that was deleted afterwards
    When the batch's handler is refused because the project was not found
    Then the whole batch completes with one warning and is not retried

  @unit
  Scenario: A refusal from either project-not-found error is recognised, however it is wrapped
    Given a failure that is authorization's or project's project-not-found error
    When it arrives directly, as the cause of another error, or as every member of an aggregate
    Then it is recognised as the project being gone

  @unit
  Scenario: A job that fails for any other reason is still retried
    Given a job whose handler fails for a reason other than a deleted project
    When the queue runs the job
    Then the failure is rethrown so the queue retries it

  @unit
  Scenario: A process-manager outbox message whose project no longer exists is retired as completed
    Given an outbox message for a project that was deleted afterwards
    When its handler is refused because the project was not found
    Then the message is marked dispatched with a warning, not dead and not retried

  @unit
  Scenario: A retention lookup for a project with no row gets the platform default, never cached
    Given a retention read names a project that project's table holds no row for
    When the Data Retention service resolves that project
    Then it answers the platform default instead of refusing
    And nothing is cached, so once the project's row exists its rules resolve

  @unit
  Scenario: A failure that says it is not retryable is not retried
    Given a job whose handler fails with an error marked retryable false
    And the error names no platform or provider fault and no 429 or unattributed 5xx status
    When the group queue decides the failure
    Then it is not retryable and spends no further attempts

  @unit
  Scenario: A platform or rate-limit failure still retries even when it is marked retryable false
    Given a job whose handler fails with a platform-fault, provider-fault, 429 or 5xx refusal marked retryable false
    When the group queue decides the failure
    Then it is retried as before

  @unit
  Scenario: Platform code asking for a proof on a deleted project is told the project was not found
    Given a project that does not exist
    When platform code asks authz for a read pass on it
    Then authz refuses with project_not_found, not access_not_granted
