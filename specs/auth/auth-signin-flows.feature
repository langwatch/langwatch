Feature: Sign-in flows (credentials, Google OAuth, enterprise OAuth)

  Ongoing, live authentication behavior for the three production sign-in
  paths. These scenarios were recovered from the now-deleted
  `phase-3-big-swap.feature` cutover spec: that file was a one-shot
  NextAuth->BetterAuth migration plan (safe to delete), but these three
  describe PERSISTENT sign-in behavior that must keep working long after the
  cutover, so they live on here as a durable spec record.

  The first two are intentionally untagged: they document live behavior
  rather than asserting a single bound test, so they are not counted by the
  feature-parity gate. Binding notes per scenario record where the behavior
  is actually exercised today. The enterprise OAuth callback-path outline is
  tagged and bound to `legacyCallbackParity.test.ts`, since that behavior has
  a real assertion rather than only browser-QA evidence.

  Ported at D13 (ADR-117): what the SCREENS do in front of these flows now
  starts with the address, and the answer to where it signs in is the
  router's - specs/identity/signin-signup-screens.feature owns and binds that,
  and specs/identity/signin-router.feature owns the decisions themselves. What
  stays here is the transport underneath, unchanged by the auth screens: the
  same endpoints, the same session cookie, and the same pinned callback paths
  that customer identity-provider applications are configured against.

  # Exercised end-to-end by the BetterAuth smoke test
  # (platform/app/e2e/auth-regression/better-auth-smoketest.ts, "Credentials
  # signin with correct password" -> HTTP 200 + session cookie).
  Scenario: On-prem credentials signin works end-to-end
    Given the deployment's default method set offers email and password
    And a user exists with a bcrypt password in their Account row
    When the screen submits the address and the routed method is the password form
    And I POST to /api/auth/sign-in/email with email + password
    Then the response sets a session cookie
    And GET /api/auth/session returns the user

  # Full OAuth round-trip is verified via browser QA, not yet automated in
  # a parity-bound test. Provider selection/credential threading is covered
  # by the buildSocialProviders unit test in
  # platform/app/src/server/better-auth/__tests__/index.test.ts.
  Scenario: Google OAuth signin works end-to-end
    Given the deployment's default method set offers Google
    And GOOGLE_CLIENT_* envs are set
    When the routed decision names Google and the screen dials it
    And I start the /api/auth/sign-in/social?provider=google flow
    Then I am redirected to google.com
    And on callback I land signed in at /

  # The regression-prone callback pins are covered by
  # `legacyCallbackParity.test.ts` and `index.test.ts`. BetterAuth core serves
  # the pinned path directly; there is no Next.js rewrite or plugin callback
  # hop. Full provider round-trips are still browser-QA evidence, not an
  # automated claim.
  @unit
  Scenario Outline: Enterprise OAuth keeps the callback path customers registered
    Given NEXTAUTH_PROVIDER is "<provider>"
    And that provider's client credentials and issuer are set
    When the screen starts sign-in with "<provider>"
    Then the authorization request uses "/api/auth/callback/<provider>" as its redirect URI
    And BetterAuth core accepts the provider callback on that same path

    Examples:
      | provider |
      | auth0    |
      | okta     |
