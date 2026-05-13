Feature: Langy chat API end-to-end flows
  To validate Langy as an AI agent in production-like conditions
  We run scenario-style checks through the public chat endpoint
  Without browser UI dependencies

  @integration
  Scenario: First user message starts a streaming Langy conversation
    Given an authenticated user with evaluation access to a project
    When the user POSTs a first message to /api/langy/chat
    Then the response is streamed as text/event-stream
    And the response includes x-langy-conversation-id

  @integration
  Scenario: Follow-up user message continues the same Langy conversation
    Given an existing x-langy-conversation-id from a prior chat call
    When the user POSTs another message with that conversationId
    Then Langy responds successfully
    And the returned x-langy-conversation-id matches the provided conversationId
