Feature: DispatchError contract for dispatch endpoints

  Dispatch endpoints (Slack webhook, trigger email) perform stake-sensitive
  side effects. When a side effect fails, the caller must learn two things:
  that it failed at all, and whether retrying could succeed. Endpoints
  communicate this by throwing a DispatchError carrying a `retryable` flag,
  rather than logging and returning as if nothing went wrong.

  The retryable flag is derived from the failure's HTTP semantics so the
  outbox worker can choose between scheduling a backoff retry and surfacing
  the row to an operator as dead.

  A failure that must not be retried still leaves open what becomes of the
  job, so a classified failure also carries a disposition: whether the
  provider itself returned the terminal verdict, or whether we rejected the
  dispatch ourselves over our own configuration or integrity. Only the former
  may leave the queue on its own.

  See dev/docs/adr/027-typed-dispatcherror-contract.md.

  # Classification policy (shared across all dispatch endpoints)

  Scenario: Rate-limit and server errors are retryable
    Given a dispatch fails with HTTP 429, a 5xx status, or a network timeout
    When the failure is classified
    Then a DispatchError is raised
    And it is marked retryable

  Scenario: Client errors are terminal
    Given a dispatch fails with a 4xx status other than 429
    When the failure is classified
    Then a DispatchError is raised
    And it is marked not retryable

  Scenario: Unclassifiable failures default to retryable
    Given a dispatch fails with an error that carries no recognizable status
    When the failure is classified
    Then a DispatchError is raised
    And it is marked retryable

  Scenario: Classified failures carry the provider's failure detail
    Given a dispatch fails with a provider error carrying both an HTTP status and a message
    When the failure is classified
    Then the DispatchError message includes the HTTP status and the provider's message
    So that an operator reading only the logged message can tell a revoked
    webhook from a rejected payload without access to the cause object

  Scenario: An oversized provider message is capped
    Given a dispatch fails with a provider error whose message exceeds the cause limit
    When the failure is classified
    Then the DispatchError message carries the detail truncated to the limit with an ellipsis
    So that one provider echoing a whole response body cannot flood the logs

  Scenario: A provider message carrying a secret is scrubbed
    Given a dispatch fails with a provider error that echoes a credential back in its message
    When the failure is classified
    Then the credential is replaced with a redaction marker before the message is built
    So that a token cannot reach logs or audit rows by riding along on a failure

  # Disposition policy: what a non-retryable failure means for the job

  Scenario: A provider's own terminal verdict is dead-lettered out of the queue
    Given a dispatch fails with a terminal HTTP status returned by the provider
    When the failure is classified
    Then the DispatchError is marked not retryable
    And it is marked as a provider-terminal failure
    So that the queue can drop a dispatch that can never succeed, rather than
    stall every later job for the same group behind it

  Scenario: A failure we classified ourselves is parked for an operator
    Given a dispatch is rejected before any provider verdict, because its
    configuration, security, or integrity check failed
    When the failure is classified
    Then the DispatchError is marked not retryable
    And it is not marked as a provider-terminal failure
    So that a broken invariant is parked for an operator to fix, rather than
    silently dead-lettered while later work proceeds on the same broken config

  # Slack webhook endpoint

  Scenario: A failing Slack webhook no longer swallows the error
    Given a Slack webhook post that fails
    When the Slack dispatch endpoint runs
    Then it raises a DispatchError instead of logging and returning
    And the retryable flag reflects the webhook's failure status

  Scenario: A revoked Slack webhook is terminal
    Given a Slack webhook that responds 404 because it was revoked
    When the Slack dispatch endpoint runs
    Then it raises a DispatchError that is not retryable

  Scenario: A successful Slack post returns without raising
    Given a Slack webhook post that succeeds
    When the Slack dispatch endpoint runs
    Then it returns normally and raises nothing

  # Trigger email endpoint

  Scenario: A throttled email send is retryable
    Given an email provider that rejects the send with a throttling/5xx response
    When the email dispatch endpoint runs
    Then it raises a retryable DispatchError

  Scenario: A rejected email address is terminal
    Given an email provider that rejects the send with a 4xx response
    When the email dispatch endpoint runs
    Then it raises a DispatchError that is not retryable

  Scenario: A successful email send returns without raising
    Given an email provider that accepts the send
    When the email dispatch endpoint runs
    Then it returns normally and raises nothing
