Feature: Suppress PostHog analytics during admin impersonation
  As a platform operator
  I want all PostHog analytics to be suppressed while an admin is impersonating a user
  So that impersonation sessions do not pollute real user metrics

  Background:
    The EE sessionHandler rewrites session.user to the impersonated user and adds
    an `impersonator` field. Today, neither the client-side PostHog hook
    (usePostHogIdentify) nor the server-side trackServerEvent checks for this
    field, so every identify, group, capture, and server event is attributed to
    the impersonated user.

    Design decisions:
    - Scope: PostHog only (Google Analytics / trackEvent is out of scope)
    - Client-side: use posthog.opt_out_capturing() / opt_in_capturing() to
      globally suppress all client-side events including autocapture
    - Server-side: trackServerEvent accepts a session/user object (not a bare
      boolean) to centralize the impersonation check and prevent forgotten-caller bugs
    - Session type: augment next-auth Session to include impersonator field
    - All server events are suppressed during impersonation, including limit_blocked

  # --- Client-side: usePostHogIdentify hook ---

  @unit
  Scenario: Disables PostHog capturing during impersonation
    Given a session with an impersonator field present
    When the usePostHogIdentify hook runs
    Then posthog.opt_out_capturing is called
    And posthog.identify is not called
    And posthog.group is not called
    And posthog.capture is not called

  @unit
  Scenario: Enables PostHog capturing and identifies user without impersonator
    Given a session without an impersonator field
    When the usePostHogIdentify hook runs
    Then posthog.opt_in_capturing is called
    And posthog.identify is called with the user ID and email

  @unit
  Scenario: Re-enables capturing and re-identifies user after impersonation ends
    Given the hook previously ran with an impersonated session
    When the session changes to a normal session without impersonator
    Then posthog.opt_in_capturing is called
    And posthog.reset is called
    And posthog.identify is called with the real user ID

  # --- Server-side: trackServerEvent ---

  @unit
  Scenario: Skips server event capture when session has impersonator
    Given PostHog is initialized
    When trackServerEvent is called with a session that has an impersonator
    Then posthog.capture is not called on the server

  @unit
  Scenario: Captures server event normally when session has no impersonator
    Given PostHog is initialized
    When trackServerEvent is called with a session without impersonator
    Then posthog.capture is called with the userId as distinctId

  @unit
  Scenario: Captures server event normally when no session is provided
    Given PostHog is initialized
    When trackServerEvent is called without a session
    Then posthog.capture is called with the userId as distinctId

  # --- Caller integration: session is passed through ---

  @integration
  Scenario: tRPC router passes session to trackServerEvent during impersonation
    Given an admin is impersonating a user via the EE session handler
    When a tracked server action completes (e.g. scenario creation)
    Then trackServerEvent receives the session with impersonator
    And no analytics event is recorded
