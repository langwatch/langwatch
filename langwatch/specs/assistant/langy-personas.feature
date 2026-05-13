Feature: Langy chat coverage across core user personas
  To ensure Langy behaves correctly for real usage patterns
  Scenario tests should cover the primary permission and mode personas
  End-to-end through the Langy chat API surface

  @integration
  Scenario: Non-expert user with evaluation access can use Langy
    Given the user has evaluations:view permission in the active project
    And the user's Langy mode is non_expert
    When the user sends a message to /api/langy/chat
    Then Langy responds with a streaming success response
    And the response includes a conversation id header

  @integration
  Scenario: Expert user with evaluation access can use Langy
    Given the user has evaluations:view permission in the active project
    And the user's Langy mode is expert
    When the user sends a message to /api/langy/chat
    Then Langy responds with a streaming success response
    And the response includes a conversation id header

  @integration
  Scenario: User without evaluation access is blocked from Langy
    Given the user does not have evaluations:view permission in the active project
    When the user sends a message to /api/langy/chat
    Then Langy returns a forbidden response
    And no streaming chat response is started
