Feature: The Talk to it doors over REST

  Main serves POST /api/voice/session and POST /api/voice/session/:sessionId/finish
  to the signed-in browser. They answer beside the tRPC procedures and call the
  same operations, which authorize the caller on the project themselves.

  @unit
  Scenario: The Talk to it panel mints a voice session over REST
    Given a signed-in user and the Talk to it form's values
    When the browser posts them to /api/voice/session
    Then a session is minted for that user
    And the signed URL, the session token and the call limit are returned

  @unit
  Scenario: A Talk to it REST request with no logged-in user is refused
    Given a request to mint a voice session with no logged-in user
    When the request is handled
    Then it is refused as unauthenticated and no session is minted

  @unit
  Scenario: The Talk to it panel reports a finished call over REST
    Given a finished call and the session token its mint returned
    When the browser posts the call to /api/voice/session/:sessionId/finish
    Then the call is ingested with an empty transcript and no cut-off by default
    And the run written, its source and its recording are returned

  @unit
  Scenario: A finish with a token that does not verify is refused by name
    Given a session token the server did not sign
    When the browser reports a finished call with it
    Then the request is refused with voice_session_invalid
