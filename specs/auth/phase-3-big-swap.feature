@integration
Feature: BetterAuth cutover — mount, swap consumers, delete NextAuth
  As a LangWatch maintainer
  I want BetterAuth to fully replace NextAuth in a single cutover
  So that we drop the Next.js coupling and keep every auth flow working

  # This is the merged cutover PR. It includes:
  # - the `better_auth_destructive` Prisma migration (TRUNCATE Session, move
  #   User.password → Account.password, drop User.password, convert
  #   User.emailVerified DateTime? → Boolean)
  # - BetterAuth mounted at /api/auth/[...all]
  # - NextAuth handler deleted
  # - ~18 consumer files edited (server + client)
  # - next-auth + @next-auth/prisma-adapter removed from package.json

  Background:
    Given the `better_auth_additive` and `better_auth_destructive` migrations
      have been applied to a test Postgres
    And the BetterAuth config in src/server/better-auth/index.ts is mounted

  # ============================================================================
  # Migration correctness
  # ============================================================================

  Scenario: Credential passwords survive the cutover
    Given a user "alice@acme.com" had a bcrypt password on User.password before the migration
    When the destructive migration runs
    Then an Account row exists with userId=alice.id, providerId='credential', password=<the same bcrypt hash>
    And User.password column no longer exists

  Scenario: Sessions are wiped on cutover
    Given sessions existed in the Session table before the migration
    When the destructive migration runs
    Then the Session table has zero rows
    And all active users must re-authenticate

  Scenario: emailVerified type conversion preserves verification state
    Given 3 users with emailVerified=2024-01-01 and 2 users with emailVerified=null
    When the destructive migration runs
    Then the 3 verified users have emailVerified=true
    And the 2 unverified users have emailVerified=false
    And the column type is boolean

  # ============================================================================
  # Signin flows
  # ============================================================================

  Scenario: On-prem credentials signin works end-to-end
    Given NEXTAUTH_PROVIDER is "email"
    And a user exists with a bcrypt password in their Account row
    When I POST to /api/auth/sign-in/email with email + password
    Then the response sets a session cookie
    And GET /api/auth/session returns the user

  Scenario: New user signup via credentials creates User + Account rows
    Given NEXTAUTH_PROVIDER is "email"
    When I sign up with email "new@example.com" + password
    Then a User row is created
    And an Account row is created with providerId='credential', accountId=<user.id>
    And a session is started

  Scenario: Google OAuth signin works end-to-end
    Given NEXTAUTH_PROVIDER is "google"
    And GOOGLE_CLIENT_* envs are set
    When I start the /api/auth/sign-in/social?provider=google flow
    Then I am redirected to google.com
    And on callback I land signed in at /

  Scenario: Auth0 OAuth signin works end-to-end
    Given NEXTAUTH_PROVIDER is "auth0"
    And AUTH0_* envs are set
    When I POST to /api/auth/sign-in/social with provider="auth0"
    Then the response contains an OAuth authorization URL pointing at Auth0
    And the redirect_uri in that URL is the LEGACY /api/auth/callback/auth0 path
      (pinned via the iter-21 redirectURI override so customer Auth0 apps
      don't need to update their allowed-callback list during cutover)
    When Auth0 calls back to /api/auth/callback/auth0?code=X&state=Y
    Then the Next.js rewrite in next.config.mjs routes the request to
      BetterAuth's plugin handler at /api/auth/oauth2/callback/auth0
    And on successful code exchange I land signed in at /

  # ============================================================================
  # SSO domain matching (ported behavior from NextAuth signIn callback)
  # ============================================================================

  Scenario: New SSO user is auto-added to the matching org
    Given an organization with ssoDomain "acme.com" and ssoProvider "google" exists
    And no user exists with email "new@acme.com"
    When "new@acme.com" signs in via Google
    Then a User row is created
    And an OrganizationUser row is created with role=MEMBER and organizationId=<the matching org>
    And pendingSsoSetup is false

  Scenario: Existing user with correct SSO provider auto-links
    Given an organization with ssoDomain "acme.com" and ssoProvider "google" exists
    And a user exists with email "existing@acme.com" and pendingSsoSetup=true
    When they sign in via Google
    Then pendingSsoSetup is set to false
    And the Account row is upserted

  Scenario: EXISTING user (with prior linked account) + wrong SSO provider → soft-block
    Given an organization with ssoDomain "acme.com" and ssoProvider "okta" exists
    And a user exists with email "existing@acme.com" and at least 1 linked Account
    When they sign in via Google (wrong provider for the SSO-enforced org)
    Then signin succeeds
    And pendingSsoSetup is set to true
    And the DashboardLayout banner is shown

  Scenario: FIRST-TIME signup (no prior account) + wrong SSO provider → hard-block
    Given an organization with ssoDomain "acme.com" and ssoProvider "okta" exists
    And no user exists with email "newsignup@acme.com"
    When "newsignup@acme.com" tries to sign up via Google
    Then beforeAccountCreate throws APIError SSO_PROVIDER_NOT_ALLOWED
    And BetterAuth redirects to /auth/error?error=SSO_PROVIDER_NOT_ALLOWED
    And the /auth/error page displays the "Your organization requires SSO login" message
    (iter-17 security fix: prevents attackers from bypassing per-org SSO
    enforcement by signing up via a different provider)

  # ============================================================================
  # Admin impersonation
  # ============================================================================

  Scenario: Admin impersonates a user
    Given an admin user (email in ADMIN_EMAILS) is signed in
    When POST /api/admin/impersonate with userIdToImpersonate=<target> and reason=<string>
    Then the response is HTTP 200 {"message":"Impersonation started"}
    And the Session.impersonating JSON column on the admin's session row is
      populated with {id, name, email, image, expires}
    And subsequent calls to getServerAuthSession return session.user = target
    And session.user.impersonator = the admin's identity

  Scenario: Admin cannot impersonate another admin
    Given an admin user is signed in
    When POST /api/admin/impersonate with userIdToImpersonate=<another admin>
    Then the response is HTTP 403 {"message":"Cannot impersonate another admin"}

  Scenario: Admin cannot impersonate a deactivated user
    Given an admin user is signed in
    When POST /api/admin/impersonate with userIdToImpersonate=<deactivated user>
    Then the response is HTTP 400 {"message":"Cannot impersonate a deactivated user"}

  Scenario: Non-admin cannot impersonate
    Given a non-admin user is signed in
    When POST /api/admin/impersonate with any userIdToImpersonate
    Then the response is HTTP 404 {"message":"Not Found"}
    (404 rather than 403 to hide the existence of admin endpoints from
    non-admins — matches the legacy NextAuth behavior)

  Scenario: Admin ends impersonation
    Given an admin user is currently impersonating a target
    When DELETE /api/admin/impersonate
    Then the response is HTTP 200 {"message":"Impersonation ended"}
    And Session.impersonating is SQL NULL
    And subsequent calls to getServerAuthSession return session.user = admin
    And session.user.impersonator is undefined

  # ============================================================================
  # tRPC context + getServerAuthSession-style helpers
  # ============================================================================

  Scenario: tRPC ctx.session is populated from BetterAuth
    Given a signed-in user hits a tRPC endpoint
    When the protected procedure runs
    Then ctx.session.user.id is the user's id
    And ctx.session.user.email is the user's email

  Scenario: Unauthenticated tRPC call is UNAUTHORIZED
    Given no session cookie
    When a protected procedure runs
    Then it throws UNAUTHORIZED

  # ============================================================================
  # Delete NextAuth
  # ============================================================================

  Scenario: NextAuth handler is gone
    When I search the repo for imports from "next-auth" or "next-auth/react"
    Then there are zero results
    And the src/pages/api/auth/[...nextauth].ts file does not exist
    And package.json has no "next-auth" or "@next-auth/prisma-adapter" entries

  Scenario: Typecheck and lint pass
    When I run "pnpm typecheck"
    Then it exits with code 0
    And no new type errors are reported in the langwatch app
