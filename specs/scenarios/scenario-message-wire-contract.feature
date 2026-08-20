Feature: Scenario message wire contract
  As an SDK consumer running simulations against LangWatch
  I want every message shape my agent emits to be accepted and preserved intact
  So that tool calls, reasoning and multimodal turns survive into the transcript instead of being rejected or silently dropped

  # The scenario SDK speaks the AG-UI message dialect: `toolCalls` and
  # `toolCallId` are camelCase, and it can emit `activity` and `reasoning`
  # roles that OpenAI's dialect has no equivalent for. LangWatch's own
  # `chatMessageSchema` speaks OpenAI's snake_case dialect. Both dialects
  # arrive on the same endpoint, so the validator accepts both.
  #
  # This matters because the validator STRIPS unknown keys: a field no member
  # of the union declares is not an error, it silently vanishes before storage.
  # A message that parses is therefore not the same as a message that survives,
  # and both halves need pinning.

  Background:
    Given a project with scenarios configured
    And an agent posting a message snapshot to the scenario events endpoint

  # ---------------------------------------------------------------
  # AG-UI dialect — shapes only the agent-message schemas accept
  # ---------------------------------------------------------------

  @unit
  Scenario: An assistant turn requesting tools keeps its tool calls
    Given the agent emits an assistant message whose tool calls use the camelCase "toolCalls" spelling
    When the snapshot is validated
    Then the snapshot is accepted
    And the tool calls are preserved with their name and arguments

  @unit
  Scenario: A tool result keeps the identifier that pairs it with its call
    Given the agent emits a tool result message carrying the camelCase "toolCallId" spelling
    When the snapshot is validated
    Then the snapshot is accepted
    And the tool call identifier is preserved

  @unit
  Scenario: An activity turn is accepted
    Given the agent emits a message with the "activity" role and a structured content object
    When the snapshot is validated
    Then the snapshot is accepted
    And the activity type and content are preserved

  @unit
  Scenario: A reasoning turn is accepted
    Given the agent emits a message with the "reasoning" role
    When the snapshot is validated
    Then the snapshot is accepted
    And the reasoning content is preserved

  @unit
  Scenario: A multimodal user turn referencing an image by source is accepted
    Given the agent emits a user message whose content is an image part with a url source
    When the snapshot is validated
    Then the snapshot is accepted
    And the image source is preserved

  @unit
  Scenario: An encrypted message payload is preserved
    Given the agent emits an assistant message carrying an encrypted value
    When the snapshot is validated
    Then the snapshot is accepted
    And the encrypted value is preserved

  # ---------------------------------------------------------------
  # OpenAI dialect — must keep working unchanged
  # ---------------------------------------------------------------

  @unit
  Scenario: An assistant turn in the OpenAI dialect keeps its tool calls
    Given the agent emits an assistant message whose tool calls use the snake_case "tool_calls" spelling
    When the snapshot is validated
    Then the snapshot is accepted
    And the tool calls are preserved with their name and arguments

  @unit
  Scenario: A message with no identifier is accepted
    Given the agent emits an assistant message carrying no id
    When the snapshot is validated
    Then the snapshot is accepted

  # ---------------------------------------------------------------
  # Event envelope
  # ---------------------------------------------------------------

  @unit
  Scenario: Scenario event types are accepted on the envelope
    Given the agent emits a snapshot whose type is a scenario event type
    When the snapshot is validated
    Then the snapshot is accepted

  @unit
  Scenario: A message snapshot rejects a message that is not an object
    Given the agent emits a snapshot whose messages array contains a bare string
    When the snapshot is validated
    Then the snapshot is rejected
