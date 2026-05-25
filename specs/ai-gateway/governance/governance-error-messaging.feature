Feature: AI Gateway — governance-friendly messaging for account-exhaustion errors

  When a governed user's request is blocked by an account-level limit they
  cannot resolve themselves, the gateway should surface an admin-actionable
  message instead of a consumer billing prompt that points the user at an
  account they do not own. There are two such limits:

    1. Gateway-origin: the organisation's own gateway budget is exhausted, and
       the gateway emits a 402. The body is fully ours to author.
    2. Provider-origin: the organisation's shared provider account has run out
       of credit or quota, and the provider returns its own terminal error
       (e.g. Anthropic's "credit balance too low" 400, OpenAI insufficient_quota).
       The body normally flows back verbatim (see error-transparency.feature).

  In both cases the honest message for a governed member is "your organisation's
  AI access is exhausted, contact your admin", not "add funds to your account",
  because the member does not hold the provider credential, the org admin does.

  The replacement is message-ONLY. The HTTP status, the error type, and the
  retry-signalling headers (Retry-After, x-should-retry) are forwarded
  unchanged. This keeps the error-transparency contract intact: agent clients
  decide retryable-vs-terminal purely from the status, so a terminal account
  error stays terminal (no retry storm) and a retryable rate-limit stays
  retryable. The transform applies ONLY to the narrow terminal account-
  exhaustion class, which is the exact complement of the retryable set the
  transparency contract protects.

  Scope and configuration:
    - The custom message is a single per-organisation string, set by an org
      admin. It is read into the gateway bundle and applied at dispatch time.
    - Default OFF for provider-origin errors: an organisation that has not set
      a message gets verbatim passthrough, unchanged, exactly as today.
    - The gateway-origin 402 always carries a human-readable message: a
      sensible default when unset, the org string when set. This closes the
      gap where the 402 budget block surfaced a bare "budget_exceeded" with no
      actionable copy.

  Agent-client rendering constraint (empirically established): a generic agent
  client echoes the upstream body message verbatim for generic errors, but for
  a credit/billing-shaped message it pattern-matches and overlays its own
  billing prompt instead. So the governance message must avoid the provider
  billing trigger wording, otherwise the client overrides it and the governed
  user is sent back to the consumer billing page.

  See also: budgets.feature and governance/budget-exceeded.feature (the 402
  body shape), error-transparency.feature (the verbatim passthrough default
  this feature narrowly excepts).

  Background:
    Given an organisation with a shared provider account behind its virtual keys
    And the gateway is reachable at its OpenAI/Anthropic-compatible endpoint

  # ==========================================================================
  # Gateway-origin (case 1): our own 402 budget block
  # ==========================================================================

  @bdd @gateway @governance-messaging @integration @unimplemented
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

  @bdd @gateway @governance-messaging @integration @unimplemented
  Scenario: Upstream account-exhaustion error is re-messaged for a governed org, status and retry headers preserved
    Given the organisation's provider account has a depleted credit balance
    And the provider returns its terminal account-exhaustion error
    And the organisation has set a governance message
    When a governed member calls through the gateway
    Then the gateway forwards the same HTTP status the provider returned
    And the error type is unchanged
    And the retry-signalling headers are unchanged
    And only the human-readable message is replaced with the organisation's governance message
    And no consumer billing prompt is surfaced to the member

  @bdd @gateway @governance-messaging @integration @unimplemented
  Scenario: A retryable rate-limit is forwarded verbatim and never re-messaged
    Given the provider returns a retryable rate-limit error rather than account exhaustion
    And the organisation has set a governance message
    When a governed member calls through the gateway
    Then the gateway forwards the rate-limit status and body verbatim
    And the governance message is not applied
    And the response stays retryable

  @bdd @gateway @governance-messaging @integration @unimplemented
  Scenario: Without a configured governance message, upstream account errors pass through verbatim
    Given the organisation has not set a governance message
    And the provider returns its terminal account-exhaustion error
    When a governed member calls through the gateway
    Then the gateway forwards the provider status and body verbatim
    And no message transform is applied

  # ==========================================================================
  # Authoring: admin-only, with a guard against the billing trigger phrase
  # ==========================================================================

  @bdd @governance @governance-messaging @integration @unimplemented
  Scenario: Only an org admin can set the organisation governance message
    Given a member without the governance management permission
    When they attempt to set the organisation governance message
    Then the request is denied
    And only a user with organisation governance management permission can set it

  @bdd @ui @governance-messaging @integration @unimplemented
  Scenario: Admin is warned when a custom governance message contains a provider billing trigger phrase
    Given an org admin is editing the organisation governance message
    When they enter a message containing a provider billing trigger phrase
    Then the editor warns that an agent client may override the message with its own billing prompt
    And the default message provided by the product does not contain a trigger phrase

  # ==========================================================================
  # End-to-end: the real wrapper shows our message, no retry loop
  # ==========================================================================

  @bdd @governance-messaging @e2e @unimplemented
  Scenario: Real agent wrapper displays the governance message and does not retry-loop on account exhaustion
    Given the organisation's provider account is exhausted and a governance message is set
    When a real agent wrapper sends a request through the gateway
    Then the wrapper displays the organisation's governance message
    And the wrapper does not show the provider's consumer billing prompt
    And the wrapper does not enter a retry loop because the status stays terminal
