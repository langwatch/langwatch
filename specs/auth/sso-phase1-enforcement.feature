Feature: SSO Phase 1 — Enforcement Gaps & SCIM Hardening
  As a platform operator
  I want SCIM race conditions fixed, SSO enforcement complete, and enterprise gates applied
  So that enterprise security controls cannot be bypassed

  # ── SCIM deleteUser Race Condition (P0) ──

  @unit
  Scenario: SCIM deleteUser atomically removes membership and deactivates user
    Given a user exists with an active organization membership
    When SCIM deleteUser is called for that user
    Then the OrganizationUser row is deleted
    And the RoleBinding rows for that org are deleted
    And the user's deactivatedAt is set
    And all three operations occur within a single database transaction

  @unit
  Scenario: SCIM deleteUser revokes sessions after deactivation
    Given a user exists with active sessions
    When SCIM deleteUser is called for that user
    Then all browser sessions for the user are revoked
    And all CLI tokens for the user are revoked

  # ── SCIM 409 on Existing Membership (P0) ──

  @unit
  Scenario: SCIM adopts existing non-SCIM membership
    Given a user has an existing OrganizationUser membership from SSO JIT
    When SCIM createUser is called for that user and organization
    Then the existing membership is updated with scimManaged set to true
    And the user resource is returned successfully

  @unit
  Scenario: SCIM reactivates deactivated user during adoption
    Given a user has an existing membership and is deactivated
    When SCIM createUser is called for that user and organization
    Then the user is reactivated
    And the membership is marked as scimManaged

  @unit
  Scenario: SCIM sets scimManaged on new user creation
    Given no user exists with the provided email
    When SCIM createUser provisions a new user
    Then the OrganizationUser row has scimManaged set to true

  # ── scimManaged Flag (Schema) ──

  @unit
  Scenario: OrganizationUser model includes scimManaged field
    Then the OrganizationUser model has a scimManaged Boolean field
    And the field defaults to false

  # ── Password Login Blocked by SSO Enforcement (P0) ──
  # tracked: implemented inline in better-auth/index.ts before-hook (the
  # sign-in/reset SSO gate). Exercising it needs the full BetterAuth instance
  # (prisma adapter + redis + env), which the in-repo integration harness
  # (testcontainers) can't boot in CI for an auth-instance import. Tracked as
  # a gap until the gate is extracted into a pure, unit-testable helper.

  @unimplemented @integration
  Scenario: Password login is rejected when SSO is enforced for the domain
    Given an organization has SSO configured with enforcement enabled
    And a user exists with an email on that SSO domain
    When the user attempts to sign in with email and password
    Then the sign-in is rejected with an SSO_ENFORCED error

  @unimplemented @integration
  Scenario: Password login succeeds when SSO is not enforced
    Given an organization has SSO configured without enforcement
    And a user exists with an email on that SSO domain
    When the user attempts to sign in with email and password
    Then the sign-in proceeds normally

  @unimplemented @integration
  Scenario: Password login succeeds for domains without SSO
    Given no organization has SSO configured for the user's email domain
    When the user attempts to sign in with email and password
    Then the sign-in proceeds normally

  # ── Password Reset Blocked by SSO Enforcement (P0) ──
  # tracked: same before-hook gate as login; see note above.

  @unimplemented @integration
  Scenario: Password reset is rejected when SSO is enforced for the domain
    Given an organization has SSO configured with enforcement enabled
    And a user exists with an email on that SSO domain
    When the user requests a password reset
    Then the request is rejected with an SSO_ENFORCED error

  @unimplemented @integration
  Scenario: Password reset succeeds for domains without SSO enforcement
    Given no organization has SSO enforcement for the user's email domain
    When the user requests a password reset
    Then the password reset proceeds normally

  # ── SCIM Routes Enterprise Plan Check (P0) ──
  # tracked: implemented via requireEnterprise() on every SCIM v2 provisioning
  # route in server/routes/scim.ts. End-to-end coverage needs app.request()
  # against the Hono app with the app-layer singleton (getApp()) stubbed; that
  # harness isn't wired for the SCIM route yet. Tracked until added.

  @unimplemented @integration
  Scenario: SCIM User endpoint rejects requests from non-enterprise org
    Given a valid SCIM bearer token for a non-enterprise organization
    When a GET request is made to /api/scim/v2/Users
    Then the response status is 403
    And the response body contains a SCIM error with detail about enterprise plan

  @unimplemented @integration
  Scenario: SCIM Group endpoint rejects requests from non-enterprise org
    Given a valid SCIM bearer token for a non-enterprise organization
    When a POST request is made to /api/scim/v2/Groups
    Then the response status is 403
    And the response body contains a SCIM error with detail about enterprise plan

  @unimplemented @integration
  Scenario: SCIM endpoints accept requests from enterprise org
    Given a valid SCIM bearer token for an enterprise organization
    When a GET request is made to /api/scim/v2/Users
    Then the response proceeds to the handler

  @unimplemented @integration
  Scenario: SCIM discovery endpoints are accessible without enterprise check
    When a GET request is made to /api/scim/v2/ServiceProviderConfig
    Then the response status is 200

  # ── SCIM Settings Page Enterprise Gate (P1) ──
  # tracked: UI gating on /settings/scim. No React Testing Library harness for
  # this page in this backend-focused Phase 1 PR; tracked with the rest of the
  # SSO/SCIM settings UI in sso-settings-ui-prototype.feature.

  @unimplemented @integration
  Scenario: Non-enterprise org sees upgrade prompt on SCIM settings page
    Given the organization does not have an enterprise license
    When the admin navigates to /settings/scim
    Then the page renders an upgrade prompt with enterprise feature alert
    And a contact sales block is displayed

  @unimplemented @integration
  Scenario: Enterprise org sees full SCIM settings page
    Given the organization has an enterprise license
    When the admin navigates to /settings/scim
    Then the SCIM token management interface is rendered
