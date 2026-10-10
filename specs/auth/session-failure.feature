Feature: A failed session read is waited out, never read as signed out

  The browser application asks `GET /api/auth/session` who is here. That read
  can fail: the API is down, a proxy refused, the network dropped. A failure
  answers nothing, so it signs nobody out. Only an answer does: a 401, or a
  reply that names no user.

  While the read has no answer, the shell holds the reader on its short
  reconnecting screen (`specs/ui/api-boot-wait.feature`) and reads again. If
  the service comes back, a signed-in reader carries on where they were,
  unaffected; a reader the service says is signed out goes to sign in. No
  toast is shown for a failed read: the reconnecting screen says enough.

  A signed-out visitor on a route that needs a session goes to the sign-in
  screen, never to onboarding: onboarding is the page that CREATES an
  organization (`platform/app/src/hooks/useRequiredSession.ts:100-116`).

  @integration
  Scenario: A failed session read is not read as signed out
    Given the session endpoint fails the read without answering who is here
    When the application resolves who is here
    Then the reader is held on the reconnecting state
    And the visitor is not sent anywhere

  @integration
  Scenario: A failed session read shows no toast
    Given the session endpoint fails the read without answering who is here
    When the application resolves who is here
    Then no failure is reported to the reader

  @integration
  Scenario: A reader whose session read recovers carries on unaffected
    Given the session endpoint failed the first read
    When the session is read again and answers with a signed-in reader
    Then the reader is signed in
    And the visitor is not sent anywhere

  @integration
  Scenario: A reader whose session read recovers to nobody goes to sign in
    Given the session endpoint failed the first read
    When the session is read again and answers that nobody is signed in
    Then the visitor is sent to the sign-in screen

  @unit
  Scenario: A failed re-read keeps the reader who was already signed in
    Given the session already answered who is here
    And a read elsewhere is refused with 403, so the session is read again
    When that re-read fails
    Then the reader stays signed in as before, as main's session cache did
    And they are not sent to sign in, so an authorization refusal never reads as a session failure

  @unit
  Scenario: A session endpoint answering 401 means nobody is signed in
    Given the session endpoint refuses the read with 401
    When the application resolves who is here
    Then nobody is signed in
    And the reader is not held on the reconnecting state

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
    Given the session endpoint answers that nobody is signed in
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
  Scenario: A refused organization graph sends an unauthenticated reader to sign in
    Given the reader is on a route inside the organization shell
    And the organization graph refuses because the caller is not authenticated
    When the shell renders
    Then the reader is sent to the sign-in screen
    And the address they asked for is carried as the callback
    And the shell it was mounted around is not rendered

  @integration
  Scenario: A refused organization graph renders its handled failure, never a blank page
    Given the reader is on a route inside the organization shell
    And the organization graph refuses with a named failure the reader can act on
    When the shell renders
    Then the copy registered for that failure code is shown
    And the trace id is offered so the reader can quote it to support
    And the reader is not sent anywhere

  @integration
  Scenario: An offline visitor is not sent to sign in
    Given the session endpoint answers that nobody is signed in
    And the browser reports it is offline
    When the application resolves who is here
    Then the visitor is not sent anywhere
