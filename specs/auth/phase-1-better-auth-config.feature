@unit
Feature: BetterAuth config (unmounted)
  As a LangWatch maintainer
  I want a fully-configured BetterAuth instance ready to use
  So that I can swap NextAuth for it in a single cutover without gaps

  # The file `langwatch/src/server/better-auth/index.ts` exports a `betterAuth`
  # instance with every provider we care about and every custom hook ported
  # from the NextAuth callbacks. BetterAuth is now the live auth handler,
  # mounted at `/api/auth/[...all]`.

  Background:
    Given the BetterAuth instance is exported from `~/server/better-auth`

  # ============================================================================
  # Provider selection via NEXTAUTH_PROVIDER env
  # ============================================================================

  Scenario: Credentials-only on-prem mode
    Given NEXTAUTH_PROVIDER is "email"
    And AUTH0_* envs are not set
    When I inspect the BetterAuth instance
    Then email-and-password signin is enabled
    And no social providers are configured

  # Bound at builder-function layer: the env-driven provider selection lives in
  # the exported pure helpers `buildSocialProviders` / `buildGenericOAuthConfigs`
  # / `isEmailPasswordEnabled` in `better-auth/index.ts`. Tests call these
  # directly with a synthetic env for each provider, so we exercise auth0/google
  # selection without re-initializing the module under a different
  # NEXTAUTH_PROVIDER (which would need vi.resetModules() and hang the shard).
  @unit
  Scenario: Auth0 enterprise mode
    Given NEXTAUTH_PROVIDER is "auth0"
    And AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_ISSUER are set
    When I inspect the BetterAuth instance
    Then the generic-oauth plugin lists an "auth0" provider
    And email-and-password is disabled (SSO-only enforcement — no email/password bypass)

  @unit
  Scenario: Google mode
    Given NEXTAUTH_PROVIDER is "google"
    And GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET are set
    When I inspect the BetterAuth instance
    Then the socialProviders list includes "google"

  # ============================================================================
  # SSO domain + provider matching (ported from NextAuth signIn callback)
  # ============================================================================

  Scenario: isSsoProviderMatch — Auth0 prefix match
    Given an organization with ssoProvider "waad|acme-azure-connection"
    And an OAuth account with providerId "auth0" and providerAccountId "waad|acme-azure-connection|user-123"
    When I call isSsoProviderMatch(org, account)
    Then it returns true

  Scenario: isSsoProviderMatch — direct provider name match
    Given an organization with ssoProvider "google"
    And an OAuth account with providerId "google" and providerAccountId "google-id-123"
    When I call isSsoProviderMatch(org, account)
    Then it returns true

  Scenario: isSsoProviderMatch — wrong provider rejected
    Given an organization with ssoProvider "okta"
    And an OAuth account with providerId "google" and providerAccountId "google-id-123"
    When I call isSsoProviderMatch(org, account)
    Then it returns false

  Scenario: isSsoProviderMatch — org without ssoProvider
    Given an organization with ssoProvider null
    And any OAuth account
    When I call isSsoProviderMatch(org, account)
    Then it returns false

  # ============================================================================
  # signIn guards (ported from NextAuth signIn callback)
  # ============================================================================

  Scenario: Deactivated user is blocked
    Given a user exists with deactivatedAt set to yesterday
    When that user signs in via any provider
    Then the signin is rejected with an error

  # @unimplemented: the BetterAuth OAuth-callback hook chain is wired but the
  # guard logic for the "active-session-with-different-email" path lives across
  # Bound at config-layer: `accountLinking.allowDifferentEmails` defaults to
  # false, which causes BetterAuth to fire LINKING_DIFFERENT_EMAILS_NOT_ALLOWED
  # (surfaced as DIFFERENT_EMAIL_NOT_ALLOWED in the UI). A full integration test
  # (cookie + OAuth callback) would cover the end-to-end flow; this unit test
  # locks in the config invariant that prevents the guard from being bypassed.
  @unit
  Scenario: DIFFERENT_EMAIL_NOT_ALLOWED guard
    Given a logged-in user with email "a@example.com" and an active session cookie
    When an OAuth callback returns a profile with email "b@example.com"
    Then the signin is rejected with a DIFFERENT_EMAIL_NOT_ALLOWED error

  Scenario: New user with matching SSO domain joins the SSO org
    Given an organization with ssoDomain "acme.com" exists
    And no user exists with email "new@acme.com"
    When a new user signs in via a matching SSO provider with email "new@acme.com"
    Then a new user is created
    And the user is added to the organization as a MEMBER
    And an Account row is created for the OAuth account

  Scenario: Existing user with correct SSO provider auto-links
    Given an organization with ssoDomain "acme.com" and ssoProvider "google" exists
    And a user exists with email "existing@acme.com" and pendingSsoSetup=false
    When that user signs in via Google
    Then the Account row is upserted
    And pendingSsoSetup remains false

  Scenario: Existing user with wrong SSO provider gets pending flag
    Given an organization with ssoDomain "acme.com" and ssoProvider "okta" exists
    And a user exists with email "existing@acme.com" and pendingSsoSetup=false
    When that user signs in via Google
    Then signin succeeds
    And pendingSsoSetup is set to true

  # ============================================================================
  # Admin impersonation via the legacy Session.impersonating JSON column
  #
  # We deliberately do NOT use BetterAuth's `admin()` plugin — it expects
  # `User.role` / `User.banned` columns our schema doesn't have, and it
  # would force an additional schema migration for no behavioral benefit.
  # Impersonation is handled end-to-end by `src/pages/api/admin/impersonate.ts`
  # writing to the existing `Session.impersonating` JSON column, and
  # `src/server/auth.ts` reading it to rewrite `session.user` on each
  # request. The compat layer also re-verifies the target user is still
  # active on each request.
  # ============================================================================

  Scenario: The BetterAuth admin plugin is intentionally omitted
    Given the BetterAuth instance is initialized
    When I inspect the configured plugins
    Then only genericOAuth is present in the plugins array
    And impersonation is handled via the legacy Session.impersonating JSON column
    And the compat layer re-verifies the impersonation target on every request

  # ============================================================================
  # bcrypt-compatible password verification
  # ============================================================================

  # Bound at verify-function layer: tests call `options.emailAndPassword.password.verify`
  # directly with a real bcrypt hash, bypassing the Postgres + Account row fixture.
  # A full integration test (actual signin API call + DB row) is a follow-up.
  @unit
  Scenario: Legacy bcrypt hashes still verify
    Given an existing user has a bcrypt hash from the NextAuth system stored in the database
    When that user tries to sign in with the correct plaintext password
    Then BetterAuth's credentials provider verifies the bcrypt hash successfully
    And the signin succeeds

  @unit
  Scenario: Wrong password is rejected
    Given an existing user has a bcrypt hash
    When that user signs in with the wrong plaintext password
    Then the signin is rejected

  # ============================================================================
  # BetterAuth is now the live handler
  #
  # Originally (during phase 1 of the migration) this file tracked a
  # "NextAuth still live, BetterAuth loaded but unmounted" phase. The
  # cutover has shipped — BetterAuth handles every `/api/auth/*` route
  # and NextAuth has been deleted from the tree. This scenario locks in
  # the post-cutover surface.
  # ============================================================================

  Scenario: BetterAuth is the live handler
    Given the BetterAuth instance is initialized
    When I visit `/api/auth/sign-in/email` in dev
    Then BetterAuth handles the request
    And no NextAuth handler is reachable on any `/api/auth/*` path
    And `pnpm typecheck` passes
