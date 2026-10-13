Feature: Playground chat availability
  As a reader opening the Prompt Studio Conversation tab
  I want to be told when this deployment runs no chat runtime
  So that I never type a message into a chat that has nowhere to post it

  # The chat posts to a chat runtime the server has to mount. The API process
  # declares that family absent at boot — "API process serves no
  # /api/copilotkit" (`apps/api/src/app/api-packaged-rest.composition.ts`) — so
  # the screen asks its host whether a runtime is mounted rather than assuming
  # one is. The host answers from the code-keyed presentation registry
  # (`prompt_playground_chat_unavailable`), which is where every other sentence
  # a customer reads about a failure comes from.

  @integration
  Scenario: The Conversation tab explains an absent chat runtime
    Given the deployment runs no playground chat runtime
    When I open the Conversation tab
    Then I am told the chat is unavailable here and why
    And no chat is mounted

  @integration
  Scenario: An absent chat runtime offers nothing to reset
    Given the deployment runs no playground chat runtime
    When I open the Conversation tab
    Then no reset control is offered

  @integration
  Scenario: The Conversation tab mounts the chat where a runtime is served
    Given the deployment runs a playground chat runtime
    When I open the Conversation tab
    Then the chat is mounted with its reset control
