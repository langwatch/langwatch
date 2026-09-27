Feature: The API process serves the auth door

  Nobody can sign in unless some process answers `/api/auth/*`. The family
  exists — the Better Auth catch-all, the session read the browser polls, the
  explicit logout and the legacy token check — and the API process composes the
  Better Auth instance behind it, but for a while it mounted no door over that
  instance and every one of those paths answered 404. That is finding F2 of
  `dev/docs/plans/e2e-walk-2026-09-03.md`: an account could be created and then
  never signed in to.

  Two facts hold this together.

  The door is the instance's. The API process mounts the family only where it
  composed the Better Auth instance itself. Where a deployment handed it a
  transport instead, the process holds no instance and none of the options that
  decide whether a cookie verifies — a second instance built here would not
  fail, it would verify nothing and answer "signed out" to everybody — so the
  family is left off rather than served over a guess.

  Order is behaviour. The catch-all claims `/auth/*`, so it would swallow every
  sibling registered after it. The CLI device grant is registered first; the
  governance CLI plane installs after the auth family, so the catch-all declines
  every `/api/auth/cli` path and hands it on, which keeps both reachable.

  @integration
  Scenario: The browser can read who is signed in
    Given a process that composed its own Better Auth instance
    When the browser reads the session endpoint
    Then it is answered by the session route rather than a 404

  @integration
  Scenario: The Better Auth catch-all serves the sign-in call
    Given a process that composed its own Better Auth instance
    When a sign-in call arrives from the deployment's own origin
    Then the Better Auth instance handles it

  @integration
  Scenario: The CLI device grant still reaches its own routes
    Given a process that composed its own Better Auth instance
    And the CLI device grant is composed alongside it
    When the CLI asks for a device code
    Then the device grant answers it rather than the Better Auth catch-all

  @integration
  Scenario: The CLI governance routes mounted after the auth family still reach their own routes
    Given the auth family mounted before a family serving "/api/auth/cli/bootstrap" and "/api/auth/cli/project-key"
    When a CLI reads "/api/auth/cli/bootstrap" with its bearer
    Then that family answers it rather than the Better Auth catch-all
    And a CLI POST to "/api/auth/cli/project-key" is not refused by the sign-in door's origin gate

  @integration
  Scenario: A process handed someone else's transport mounts no auth door
    Given a process that composed no Better Auth instance of its own
    When the browser reads the session endpoint
    Then no auth family is mounted, so nothing answers "signed out" on a guess
