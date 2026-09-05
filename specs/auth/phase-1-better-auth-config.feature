@unit
Feature: BetterAuth config (unmounted)
  As a LangWatch maintainer
  I want a fully-configured BetterAuth instance ready to use
  So that I can swap NextAuth for it in a single cutover without gaps

  # The file `platform/app/src/server/better-auth/index.ts` exports a `betterAuth`
  # instance with every provider we care about and every custom hook ported
  # from the NextAuth callbacks. BetterAuth is now the live auth handler,
  # mounted at `/api/auth/[...all]`.
  #
  # Three mechanisms here were superseded by the router (D03/D13, ADR-117).
  # They are described as what they became rather than deleted, because the
  # rows they wrote are still in the database:
  #
  #   - the `NEXTAUTH_PROVIDER` matrix below no longer decides WHERE anyone
  #     signs in. Routing is the router's (specs/identity/signin-router.feature),
  #     and what the env names is now the deployment's default METHOD SET
  #     (ADR-117 §4). Which providers get mounted, and the email/password gate
  #     that comes with them, are unchanged and stay here.
  #   - `isSsoProviderMatch` is replaced by callback linking on the router
  #     (ADR-117 §3: two-sided evidence, or a proposal a human resolves).
  #   - `pendingSsoSetup` is reconciled once against identifier data and the
  #     column then dropped (D03 plan item 5).
  #
  # What stays here is what is still live: which providers get mounted, and
  # the email/password gate that comes with them.

  Background:
    Given the BetterAuth instance is exported from `~/server/better-auth`

  # ============================================================================
  # Provider selection via NEXTAUTH_PROVIDER env
  #
  # What these scenarios assert is MOUNTING: which providers the instance
  # stands up, and whether email and password sign-in is enabled beside them.
  # That survives the auth screens (ADR-117 §4) - the env's provider becomes the
  # default method set, one element, offered automatically, which is what a
  # single-provider deployment already does. Where a person is SENT is no
  # longer decided here.
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
  #
  # Retires at the flip: the router's callback linking replaces string
  # matching with evidence (ADR-117 §3), and a match it cannot make
  # unambiguously becomes a proposal for a human rather than a guess. Kept
  # while the legacy callback is still the one that runs.
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

  # `pendingSsoSetup` is the flag this sets; it is reconciled once against
  # identifier data and dropped at bake end. Under the auth screens the same
  # situation is a routing decision the screen explains instead (ADR-117 §6).
  Scenario: Existing user with wrong SSO provider gets pending flag
    Given an organization with ssoDomain "acme.com" and ssoProvider "okta" exists
    And a user exists with email "existing@acme.com" and pendingSsoSetup=false
    When that user signs in via Google
    Then signin succeeds
    And pendingSsoSetup is set to true

  # ============================================================================
  # RETIRED at D06 — the legacy impersonation pair, and the plugin allow-list
  #
  # This block described impersonation as the `Session.impersonating` JSON
  # column, and asserted that generic OAuth was the ONLY registered plugin.
  # Both statements are now false and neither is worth restating here.
  #
  # Impersonation rides the authorization principal, `{actor, subject}`, and
  # what a session carries is described where the rest of the session shape
  # is: specs/identity/mfa-and-session-shape.feature. The behaviour it used to
  # protect survives untouched in specs/auth/impersonation-banner.feature,
  # specs/ops/dejaview-impersonation-access.feature and
  # specs/features/backoffice-user-impersonation-reason.feature — only the
  # mechanism underneath swapped.
  #
  # The plugin allow-list moved too, and for a reason this block could not
  # have carried: the passkey plugin is mounted on every deployment and the
  # two-factor plugin joins generic OAuth when MFA_ENROLLMENT_OPEN is on, so
  # "only genericOAuth" was never a statement about the product. What survives is the
  # part that was ever load-bearing — BetterAuth's `admin()` plugin is
  # deliberately NOT registered, because it expects `User.role` / `User.banned`
  # columns our schema does not have and would take impersonation over — and
  # that lives in specs/identity/mfa-and-session-shape.feature and
  # specs/identity/passkeys.feature.
  # ============================================================================

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
