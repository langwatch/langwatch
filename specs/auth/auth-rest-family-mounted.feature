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
  Scenario: A process with no Better Auth instance still declares the auth family
    Given a process that composed no Better Auth instance of its own
    When the browser reads the session endpoint
    Then the session answers null, signed out
    And a sign-in attempt is refused as unavailable with the code service_unavailable

  @integration
  Scenario: Signing out of a single sign-on session ends only the LangWatch session
    Given a session that came through an SSO identity provider
    And that provider's discovery document advertises its own sign-out page
    When the user signs out of LangWatch
    Then only the LangWatch session ends
    And the user lands on the sign-in page, never on the provider's sign-out page

  @unit
  Scenario: A sign-in call from another origin is refused with a 403
    Given a call to the auth family from an origin the deployment does not trust
    When the sign-in door answers
    Then it is a 403 in JSON with the message "Invalid origin" and the code INVALID_ORIGIN

  @unit
  Scenario: The sign-in engine's answer passes through untouched
    Given the Better Auth engine answered a call
    When the sign-in door answers
    Then the browser receives that very response

  @unit
  Scenario: A replaced redirect target keeps the engine's status, headers and cookies
    Given the engine answered with a redirect and several cookies
    And a step replaced the redirect target
    When the sign-in door answers
    Then only the location changes
    And the status, the other headers, every cookie and the body are the engine's

  @unit
  Scenario: A sign-in callback that failed on the server redirects to the error screen
    Given a sign-in callback failed on the server
    When the sign-in door answers
    Then it is a 302 to the error screen with no body
