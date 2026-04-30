@unimplemented
Feature: Suppress analytics tracking during admin impersonation and label admin users
  As a LangWatch product team member
  I want analytics tracking suppressed when an admin impersonates a user
  So that impersonation sessions do not pollute product analytics, email nurturing, or lead enrichment data

  Admin impersonation already sets `session.user.impersonator` on the session
  object. This feature wires that signal into every analytics integration so
  that no events, identifications, or trait syncs fire under the impersonated
  user's identity.

  Safety constraint: Client-side PostHog suppression MUST use the `before_send`
  callback (return null to drop events), NOT `opt_out_capturing` /
  `opt_in_capturing`. The latter caused a production outage (PR #2244 / #2398)
  due to a race condition with session recording initialization.

  The `before_send` callback cannot access React context or the session directly.
  A mutable ref (updated by a useEffect watching the session) provides the
  impersonation state to the closure. This avoids re-initializing PostHog on
  session changes.

  Additionally, admin users (matched by ADMIN_EMAILS) are labeled with
  `is_admin: true` in PostHog and Customer.io so their normal (non-impersonation)
  activity can be filtered from dashboards and excluded from nurturing sequences.
  Admin status is surfaced to the client via the publicEnv tRPC query, following
  the existing `isOpsSidebarEmail` pattern in `publicEnvRouter`.

  Out of scope:
  - GTM / Google Analytics: already suppressed in ExtraFooterComponents.tsx
    via `if (!session.data.user.impersonator)` guard. No changes needed.
  - Customer.io event-sourcing reactors: reactors run in background workers
    from BullMQ jobs and have no session context. Suppressing reactor CIO calls
    requires propagating impersonation state into the event schema at trace
    ingestion time — a separate issue.

  # ===========================================================================
  # Goal 1 — Suppress tracking during impersonation
  # ===========================================================================

  # ---------------------------------------------------------------------------
  # Client-side PostHog suppression (before_send)
  # ---------------------------------------------------------------------------

  @unit
  Scenario: PostHog before_send callback drops capture events during impersonation
    Given a before_send callback with the impersonation ref set to true
    When PostHog passes a capture event to before_send
    Then the callback returns null
    And the event is not sent to PostHog

  @unit
  Scenario: PostHog before_send callback allows capture events for normal sessions
    Given a before_send callback with the impersonation ref set to false
    When PostHog passes a capture event to before_send
    Then the callback returns the event unchanged

  @unit
  Scenario: before_send allows $snapshot events during impersonation
    Given a before_send callback with the impersonation ref set to true
    When PostHog passes a $snapshot event to before_send
    Then the callback returns the event unchanged
    And session recording is not disrupted

  @unit
  Scenario: before_send allows feature flag requests during impersonation
    Given a before_send callback with the impersonation ref set to true
    When a feature flag is evaluated via the PostHog client
    Then the flag evaluation succeeds
    And the before_send callback does not intercept flag requests

  @unit
  Scenario: Error capture remains available during impersonation
    Given a before_send callback with the impersonation ref set to true
    When an exception is captured via posthogErrorCapture
    Then the error event is not suppressed by before_send

  @integration
  Scenario: PostHog init wires before_send without calling opt_in or opt_out
    Given the PostHog client is being initialized via usePostHog
    When the init options are configured
    Then the options include a before_send callback
    And opt_in_capturing is never called
    And opt_out_capturing is never called

  @integration
  Scenario: Impersonation ref updates when session changes
    Given a useEffect watches the session for impersonation state
    When the session transitions from normal to impersonated
    Then the mutable impersonation ref is set to true
    And existing before_send closures read the updated value

  # ---------------------------------------------------------------------------
  # Client-side PostHog identify suppression
  # ---------------------------------------------------------------------------

  @unit
  Scenario: usePostHogIdentify skips identify when session has impersonator
    Given a session with user.impersonator set
    When usePostHogIdentify runs
    Then posthog.identify is not called
    And posthog.group is not called

  @unit
  Scenario: usePostHogIdentify calls identify for normal sessions
    Given a session with no impersonator
    And the session has a user ID and email
    When usePostHogIdentify runs
    Then posthog.identify is called with the user ID and email

  # ---------------------------------------------------------------------------
  # Server-side PostHog suppression (trackServerEvent)
  # ---------------------------------------------------------------------------

  @unit
  Scenario: trackServerEvent skips capture when session indicates impersonation
    Given a session with user.impersonator set
    When trackServerEvent is called with the session and event data
    Then posthog.capture is not called

  @unit
  Scenario: trackServerEvent captures events for normal sessions
    Given a session with no impersonator
    When trackServerEvent is called with the session and event data
    Then posthog.capture is called with the user ID and event

  # trackServerEvent accepts an optional `session` parameter. When provided
  # and session.user.impersonator is set, capture is skipped. All existing
  # call sites in tRPC routes pass `ctx.session`. Call sites without session
  # context (e.g. background jobs) continue to work — the guard only fires
  # when session is explicitly provided.

  # ---------------------------------------------------------------------------
  # Customer.io nurturing hooks suppression
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Nurturing hooks skip firing during impersonation sessions
    Given an admin is impersonating a user via a tRPC route
    And the route context has session.user.impersonator set
    When a nurturing hook is triggered by a tRPC mutation
    Then no Customer.io identify or track calls are made

  @integration
  Scenario: Nurturing hooks fire normally for non-impersonation sessions
    Given a regular user performs a tRPC mutation that triggers nurturing
    And the route context has no impersonator on the session
    When the nurturing hook fires
    Then Customer.io identify and track calls are made as expected

  # ---------------------------------------------------------------------------
  # afterSessionCreate dead-code fix
  # ---------------------------------------------------------------------------

  @regression @unit
  Scenario: afterSessionCreate receives isImpersonationSession true from impersonation caller
    Given the BetterAuth session.create after-hook fires for an impersonation session
    When afterSessionCreate is invoked
    Then isImpersonationSession is passed as true
    And lastLoginAt is not updated for the impersonated user
    And nurturing hooks are not fired

  @regression @unit
  Scenario: afterSessionCreate receives isImpersonationSession false for normal login
    Given the BetterAuth session.create after-hook fires for a normal login
    When afterSessionCreate is invoked
    Then isImpersonationSession is passed as false
    And lastLoginAt is updated for the user
    And nurturing hooks are fired

  # ---------------------------------------------------------------------------
  # Reo suppression
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Reo identification is skipped during impersonation
    Given an admin is impersonating a user
    And the session has user.impersonator set
    When SignedInExtraFooterComponents renders
    Then Reo.identify is not called

  @integration
  Scenario: Reo identification fires for normal sessions
    Given a regular user is logged in
    And the session has no impersonator
    When SignedInExtraFooterComponents renders
    Then Reo.identify is called with the user's email and organization

  # ---------------------------------------------------------------------------
  # Pendo and Crisp regression guard
  # ---------------------------------------------------------------------------

  @regression @integration
  Scenario: Pendo script is not rendered during impersonation
    Given an admin is impersonating a user
    When SignedInExtraFooterComponents renders
    Then the Pendo initialization script is not included in the output

  @regression @integration
  Scenario: Crisp chat is not rendered during impersonation
    Given an admin is impersonating a user
    When SignedInExtraFooterComponents renders
    Then the Crisp chat widget script is not included in the output

  # ===========================================================================
  # Goal 2 — Label admin users in analytics
  # ===========================================================================

  # ---------------------------------------------------------------------------
  # PostHog admin labeling
  # ---------------------------------------------------------------------------

  @integration
  Scenario: PostHog identify includes is_admin true for admin users
    Given a user whose email is in the ADMIN_EMAILS list
    And the user is not impersonating anyone
    When usePostHogIdentify runs
    Then posthog.identify person properties include is_admin true

  @integration
  Scenario: PostHog identify includes is_admin false for non-admin users
    Given a user whose email is not in the ADMIN_EMAILS list
    When usePostHogIdentify runs
    Then posthog.identify person properties include is_admin false

  # ---------------------------------------------------------------------------
  # Customer.io admin labeling
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Customer.io identify includes is_admin trait for admin users
    Given a user whose email is in the ADMIN_EMAILS list
    When the user is identified in Customer.io via nurturing hooks
    Then the CioPersonTraits include is_admin true

  @integration
  Scenario: Customer.io identify includes is_admin false for non-admin users
    Given a user whose email is not in the ADMIN_EMAILS list
    When the user is identified in Customer.io via nurturing hooks
    Then the CioPersonTraits include is_admin false

  # ---------------------------------------------------------------------------
  # Admin status surfaced to client via publicEnv
  # ---------------------------------------------------------------------------

  @integration
  Scenario: publicEnv exposes isAdmin flag for admin users
    Given a user whose email is in the ADMIN_EMAILS list
    When the publicEnv tRPC query resolves
    Then the response includes IS_ADMIN set to true

  @integration
  Scenario: publicEnv exposes isAdmin false for non-admin users
    Given a user whose email is not in the ADMIN_EMAILS list
    When the publicEnv tRPC query resolves
    Then the response includes IS_ADMIN set to false

  @unit
  Scenario: publicEnv returns IS_ADMIN false when ADMIN_EMAILS is not configured
    Given the ADMIN_EMAILS environment variable is not set
    When the publicEnv tRPC query resolves for any user
    Then the response includes IS_ADMIN set to false
