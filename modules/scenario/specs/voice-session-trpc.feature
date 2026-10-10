Feature: The Talk to it doors over tRPC

  The mintVoiceSession procedure answers the signed-in browser beside the REST
  doors and calls the same operation.

  @unit
  Scenario: A Talk to it tRPC request with no logged-in user is refused
    Given a request to mint a voice session with no logged-in user
    When the request is handled
    Then it is refused as unauthenticated and no session is minted
