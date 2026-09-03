Feature: A refused session read degrades to signed out

  The browser application asks `GET /api/auth/session` who is here. That read
  can fail — the route is missing, the API is down, the network dropped — and
  the answer to "who is here" is then not known.

  The rule, carried over from `platform/app`
  (`platform/app/src/utils/auth-client.tsx:114`, `if (!res.ok) return
  _cachedSession;`): a read that failed is SIGNED OUT for routing purposes.
  Nobody is held on an empty document waiting for an answer that is never
  coming. The failure itself is not swallowed — it is reported once through
  the handled-error path, so the reader is told the platform is having trouble
  rather than left to guess why they were signed out.

  And a signed-out visitor on a route that needs a session goes to the sign-in
  screen, never to onboarding: onboarding is the page that CREATES an
  organization, and offering it to somebody who has not said who they are asks
  the wrong question (`platform/app/src/hooks/useRequiredSession.ts:100-116`).

  Findings F4, F5 and F7 of `dev/docs/plans/e2e-walk-2026-09-03.md`.

  @integration
  Scenario: A refused session read reads as signed out
    Given the session endpoint refuses the read
    When the application resolves who is here
    Then nobody is signed in
    And the session is settled, so the screens render rather than wait

  @integration
  Scenario: A refused session read is reported through the handled-error path
    Given the session endpoint refuses the read
    When the application resolves who is here
    Then the reader is shown the failure copy registered for the session code
    And the failure is reported once, not once per render

  @integration
  Scenario: A session answering that nobody is signed in reports nothing
    Given the session endpoint answers that nobody is signed in
    When the application resolves who is here
    Then nobody is signed in
    And no failure is reported

  @integration
  Scenario: A signed-out visitor on an authenticated route goes to sign in
    Given the session endpoint answers that nobody is signed in
    And the visitor is on an authenticated route
    When the application resolves who is here
    Then the visitor is sent to the sign-in screen
    And the address they asked for is carried as the callback

  @integration
  Scenario: A signed-out visitor on a public route stays where they are
    Given the session endpoint answers that nobody is signed in
    And the visitor is on the sign-in screen
    When the application resolves who is here
    Then the visitor is not sent anywhere

  @integration
  Scenario: A signed-out visitor is not sent to onboarding
    Given the session endpoint refuses the read
    And the visitor is on the application root
    When the application resolves who is here
    Then the visitor is sent to the sign-in screen
    And the visitor is not sent to onboarding

  @integration
  Scenario: A signed-in reader is left where they are
    Given the session endpoint answers with a signed-in reader
    And the visitor is on an authenticated route
    When the application resolves who is here
    Then the visitor is not sent anywhere

  @integration
  Scenario: An offline visitor is not sent to sign in
    Given the session endpoint refuses the read
    And the browser reports it is offline
    When the application resolves who is here
    Then the visitor is not sent anywhere
