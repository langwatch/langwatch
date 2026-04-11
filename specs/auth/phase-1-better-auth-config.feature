@unit
Feature: BetterAuth config (unmounted)
  As a LangWatch maintainer
  I want a fully-configured BetterAuth instance ready to use
  So that I can swap NextAuth for it in a single cutover without gaps

  # The file `langwatch/src/server/better-auth/index.ts` exports a `betterAuth`
  # instance with every provider we care about and every custom hook ported
  # from the NextAuth callbacks. This phase does NOT mount it — NextAuth is
  # still the live handler. This is pure code + tests.

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

  Scenario: Auth0 enterprise mode
    Given NEXTAUTH_PROVIDER is "auth0"
    And AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_ISSUER are set
    When I inspect the BetterAuth instance
    Then the generic-oauth plugin lists an "auth0" provider
    And email-and-password is still enabled for admin fallback

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
  # Admin impersonation via admin plugin
  # ============================================================================

  Scenario: Admin plugin is configured for impersonation
    Given the BetterAuth instance is initialized
    When I inspect the configured plugins
    Then the admin plugin is present
    And impersonation is supported via the admin plugin

  # ============================================================================
  # bcrypt-compatible password verification
  # ============================================================================

  Scenario: Legacy bcrypt hashes still verify
    Given an existing user has a bcrypt hash from the NextAuth system stored in the database
    When that user tries to sign in with the correct plaintext password
    Then BetterAuth's credentials provider verifies the bcrypt hash successfully
    And the signin succeeds

  Scenario: Wrong password is rejected
    Given an existing user has a bcrypt hash
    When that user signs in with the wrong plaintext password
    Then the signin is rejected

  # ============================================================================
  # The config file does not mount yet
  # ============================================================================

  Scenario: NextAuth is still the live handler
    Given this phase is complete
    When I visit `/api/auth/signin` in dev
    Then NextAuth still renders the page
    And BetterAuth is not wired to any request handler yet
    And `pnpm typecheck` passes
