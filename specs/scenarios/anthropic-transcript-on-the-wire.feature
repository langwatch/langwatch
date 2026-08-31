Feature: Anthropic-format transcripts reach the run conversation
  As someone who tests an agent built on the Anthropic SDK or on Claude Code,
  I want the platform to keep every turn of the conversation its adapter reports,
  so that the run drawer shows the tool calls the judge graded and not only the first reply.

  # Background
  #
  # An adapter can return the messages of the Anthropic Messages API as they
  # are: an assistant turn is an array of `thinking`, `text` and `tool_use`
  # blocks, and a user turn carries the `tool_result` blocks that answer the
  # calls. The scenario SDK passes an array return through to the message
  # snapshot, and the scenario-events route validates every snapshot before it
  # is stored. Neither the AG-UI message schema nor the tracer chat message
  # schema knew a `tool_use` or `thinking` block, so every snapshot after the
  # first tool call was refused with 400 and the run kept only the last
  # snapshot that validated: the user message and the first assistant text.
  # The judge, which runs in the SDK process, still read the whole transcript,
  # so the verdict cited work the drawer did not show.

  @unit
  Scenario: An assistant turn with Anthropic tool_use blocks validates on the wire
    Given a message snapshot whose assistant message content is an array of a text block and a tool_use block
    When the wire validator parses the event
    Then the parse succeeds
    And the tool_use block keeps its id, name and input

  @unit
  Scenario: A user turn with Anthropic tool_result blocks validates on the wire
    Given a message snapshot whose user message content is an array of a tool_result block with a tool_use_id and a content string
    When the wire validator parses the event
    Then the parse succeeds
    And the tool_result block keeps its tool_use_id and content

  @unit
  Scenario: A text block keeps the citations it carries
    Given a message snapshot whose assistant turn holds a text block with citations beside a tool_use block
    When the wire validator parses the event
    Then the parse succeeds
    And the text block keeps its citations

  @unit
  Scenario: Thinking blocks of an assistant turn validate on the wire
    Given a message snapshot whose assistant message content holds a thinking block, a text block and a tool_use block
    When the wire validator parses the event
    Then the parse succeeds

  @unit
  Scenario: A plain text array still validates through the members that came before
    Given a message snapshot whose message content is an array of text blocks only
    When the wire validator parses the event
    Then the parse succeeds
    And the message keeps its top-level tool_calls when it declares them

  @unit
  Scenario: The Claude Code adapter of the skill tests reports tool calls as AI SDK parts
    Given a Claude Code stream-json transcript with a thinking block, a text block, a tool_use block and its tool_result
    When the adapter converts the transcript
    Then the assistant message holds one text part followed by a tool-call part with the tool name and input
    And the tool result becomes a tool message with a tool-result part that names the tool it answers
    And the thinking block is not part of the conversation
