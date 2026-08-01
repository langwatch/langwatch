Feature: Sign-in flows (credentials, Google OAuth, Auth0 OAuth)

  Ongoing, live authentication behavior for the three production sign-in
  paths. These scenarios were recovered from the now-deleted
  `phase-3-big-swap.feature` cutover spec: that file was a one-shot
  NextAuth->BetterAuth migration plan (safe to delete), but these three
  describe PERSISTENT sign-in behavior that must keep working long after the
  cutover, so they live on here as a durable spec record.

  These are intentionally untagged: they document live behavior rather than
  asserting a single bound test, so they are not counted by the
  feature-parity gate. Binding notes per scenario record where the behavior
  is actually exercised today.

  # Exercised end-to-end by the BetterAuth smoke test
  # (langwatch/e2e/auth-regression/better-auth-smoketest.ts, "Credentials
  # signin with correct password" -> HTTP 200 + session cookie).
  Scenario: On-prem credentials signin works end-to-end
    Given NEXTAUTH_PROVIDER is "email"
    And a user exists with a bcrypt password in their Account row
    When I POST to /api/auth/sign-in/email with email + password
    Then the response sets a session cookie
    And GET /api/auth/session returns the user

  # Full OAuth round-trip is verified via browser QA, not yet automated in
  # a parity-bound test. Provider selection/credential threading is covered
  # by the buildSocialProviders unit test in
  # langwatch/src/server/better-auth/__tests__/index.test.ts.
  Scenario: Google OAuth signin works end-to-end
    Given NEXTAUTH_PROVIDER is "google"
    And GOOGLE_CLIENT_* envs are set
    When I start the /api/auth/sign-in/social?provider=google flow
    Then I am redirected to google.com
    And on callback I land signed in at /

  # The regression-prone part of this flow — the legacy redirect_uri pin
  # (/api/auth/callback/auth0) that customer Auth0 apps depend on — is
  # locked by a unit test in
  # langwatch/src/server/better-auth/__tests__/index.test.ts. The full OAuth
  # round-trip is verified via browser QA, not yet automated.
  Scenario: Auth0 OAuth signin works end-to-end
    Given NEXTAUTH_PROVIDER is "auth0"
    And AUTH0_* envs are set
    When I POST to /api/auth/sign-in/social with provider="auth0"
    Then the response contains an OAuth authorization URL pointing at Auth0
    And the redirect_uri in that URL is the LEGACY /api/auth/callback/auth0 path
      (pinned via the redirectURI override so customer Auth0 apps
      don't need to update their allowed-callback list during cutover)
    When Auth0 calls back to /api/auth/callback/auth0?code=X&state=Y
    Then the Next.js rewrite in next.config.mjs routes the request to
      BetterAuth's plugin handler at /api/auth/oauth2/callback/auth0
    And on successful code exchange I land signed in at /
