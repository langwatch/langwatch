Feature: Suppress PostHog analytics during admin impersonation
  As a platform operator
  I want all PostHog analytics to be suppressed while an admin is impersonating a user
  So that impersonation sessions do not pollute real user metrics

  Background:
    The EE sessionHandler allows admins to impersonate users for support
    and debugging. During impersonation, all actions appear as if performed
    by the impersonated user. Analytics events should not be recorded
    during these sessions to avoid polluting real user metrics.

    Design decisions:
    - Scope: PostHog only (Google Analytics is out of scope)
    - All PostHog events are suppressed during impersonation, including
      autocapture, page views, identify, group, and server-side events
    - All server-side tracked events are suppressed, including limit_blocked

  @unit
  Scenario: No analytics are recorded during an impersonation session
    Given an admin is impersonating a user
    When the impersonated session is active
    Then no PostHog events are recorded for the impersonated user
    And no user identification is sent to PostHog
    And no organization grouping is sent to PostHog

  @unit
  Scenario: Analytics resume normally after impersonation ends
    Given an admin was impersonating a user
    When the admin stops impersonating and returns to their own session
    Then the previous impersonated identity is cleared from PostHog
    And the admin is identified as themselves in PostHog
    And analytics events resume recording normally

  @unit
  Scenario: Analytics work normally for non-impersonated sessions
    Given a regular user is logged in without impersonation
    When the user performs actions in the dashboard
    Then PostHog records events attributed to that user
    And the user is identified in PostHog with their ID and email

  @unit
  Scenario: Server-side events are suppressed during impersonation
    Given an admin is impersonating a user
    When the impersonated user triggers a tracked server action
    Then no server-side analytics event is recorded

  @unit
  Scenario: Server-side events record normally without impersonation
    Given a regular user is logged in without impersonation
    When the user triggers a tracked server action
    Then the server-side analytics event is recorded for that user

  @integration
  Scenario: Tracked server actions suppress analytics during impersonation
    Given an admin is impersonating a user via the session handler
    When a server action that tracks analytics completes
    Then no analytics event reaches PostHog
