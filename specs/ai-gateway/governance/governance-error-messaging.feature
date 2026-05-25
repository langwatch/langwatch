Feature: AI Gateway — governance-friendly messaging for account-exhaustion errors

  When a governed member's request is blocked by an account-level limit they
  cannot resolve themselves, the gateway surfaces an admin-actionable message
  instead of a consumer billing prompt that points the member at an account
  they do not own. There are two such limits:

    1. Gateway-origin: the organisation's own gateway budget is exhausted, and
       the gateway emits a 402. The body is authored by the gateway.
    2. Provider-origin: the organisation's shared provider account has run out
       of credit or quota, and the provider returns its own terminal error
       (e.g. Anthropic's "credit balance too low" 400, OpenAI insufficient_quota).
       The body normally flows back verbatim (see error-transparency.feature).

  In both cases the honest message for a governed member is "your organisation's
  AI access is exhausted, contact your admin", not "add funds to your account",
  because the member does not hold the provider credential, the org admin does.

  The message is a fixed product string, hardcoded in the gateway and applied
  uniformly to every organisation. It is not configurable per organisation:
  there is no setting, no UI, no database column. The string is authored to
  avoid the provider billing trigger wording, so a generic agent client renders
  it verbatim rather than overlaying its own billing prompt.

  The replacement is message-ONLY. The HTTP status, the error type, and the
  retry-signalling headers (Retry-After, x-should-retry) are forwarded
  unchanged. This keeps the error-transparency contract intact: agent clients
  decide retryable-vs-terminal purely from the status, so a terminal account
  error stays terminal (no retry storm) and a retryable rate-limit stays
  retryable, untouched. The transform applies ONLY to the narrow terminal
  account-exhaustion class, which is the exact complement of the retryable set
  the transparency contract protects.

  See also: budgets.feature and governance/budget-exceeded.feature (the 402
  body shape), error-transparency.feature (the verbatim passthrough default
  this feature narrowly excepts for the account-exhaustion class).

  Background:
    Given an organisation with a shared provider account behind its virtual keys
    And the gateway is reachable at its OpenAI/Anthropic-compatible endpoint

  # ==========================================================================
  # Gateway-origin (case 1): our own 402 budget block
  # ==========================================================================

  @bdd @gateway @governance-messaging @integration
  Scenario: Gateway-origin budget block carries an admin-actionable message a generic agent client renders
    Given the organisation's gateway budget is exhausted
    When a governed member's agent is blocked mid-session
    Then the gateway responds with HTTP 402
    And the response carries a human-readable message that tells the member to contact their admin
    And the message is not a bare error code
    And a generic agent client that echoes the body message displays it to the member

  # ==========================================================================
  # Provider-origin (case 2): re-message the upstream account error
  # ==========================================================================

  @bdd @gateway @governance-messaging @integration
  Scenario: Upstream account-exhaustion error is re-messaged, status and retry headers preserved
    Given the organisation's provider account has a depleted credit balance
    And the provider returns its terminal account-exhaustion error
    When a governed member calls through the gateway
    Then the gateway forwards the same HTTP status the provider returned
    And the error type is unchanged
    And the retry-signalling headers are unchanged
    And only the human-readable message is replaced with the governance message
    And no consumer billing prompt is surfaced to the member

  @bdd @gateway @governance-messaging @integration
  Scenario: A retryable rate-limit is forwarded verbatim and never re-messaged
    Given the provider returns a retryable rate-limit error rather than account exhaustion
    When a governed member calls through the gateway
    Then the gateway forwards the rate-limit status and body verbatim
    And the governance message is not applied
    And the response stays retryable

  # ==========================================================================
  # End-to-end: the real wrapper shows our message, no retry loop
  # ==========================================================================

  @bdd @governance-messaging @e2e @unimplemented
  Scenario: Real agent wrapper displays the governance message and does not retry-loop on account exhaustion
    Given the organisation's provider account is exhausted
    When a real agent wrapper sends a request through the gateway
    Then the wrapper displays the governance message
    And the wrapper does not show the provider's consumer billing prompt
    And the wrapper does not enter a retry loop because the status stays terminal
