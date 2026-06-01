Feature: DispatchError contract for dispatch endpoints

  Dispatch endpoints (Slack webhook, trigger email) perform stake-sensitive
  side effects. When a side effect fails, the caller must learn two things:
  that it failed at all, and whether retrying could succeed. Endpoints
  communicate this by throwing a DispatchError carrying a `retryable` flag,
  rather than logging and returning as if nothing went wrong.

  The retryable flag is derived from the failure's HTTP semantics so the
  outbox worker can choose between scheduling a backoff retry and surfacing
  the row to an operator as dead.

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

  # Callers must uphold the contract (legacy cron path)

  Scenario: Dispatch wrappers in the cron path propagate failures
    Given the legacy custom-graph cron path dispatches a trigger action
    And the underlying dispatch endpoint raises a DispatchError
    When the action wrapper handles the failure
    Then it captures the exception with action-specific context
    And it rethrows so the caller does not record the alert as sent
