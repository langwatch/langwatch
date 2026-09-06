Feature: Bedrock Converse span I/O extraction
  As an operator viewing traces from AWS Bedrock instrumentation
  I want Converse-shaped payloads to reach the trace summary input/output
  So that Bedrock traces don't read as empty (or as span-name/HTTP noise)
  while the real content sits unread in span attributes.

  # The AWS Converse API's content-block union is discriminated by WHICH KEY
  # IS PRESENT ({text}, {toolUse}, {toolResult}) rather than by a `type`
  # field. A trace whose messages use these blocks must still surface its
  # real prompt and completion in the trace summary instead of degrading to
  # the span name or the HTTP status.

  Background:
    Given the canonicalisation pipeline runs before trace I/O extraction

  @unit @canonicalisation
  Scenario: Converse typeless text block survives extraction
    Given a Bedrock trace whose user and assistant messages carry a text block with no type field
    When trace I/O is extracted
    Then the trace summary shows the real prompt and completion

  @unit @canonicalisation
  Scenario: Converse toolUse block survives extraction
    Given a Bedrock trace whose assistant message carries a tool use block with a name and input
    When trace I/O is extracted
    Then the output text contains the JSON of the tool call's input

  @unit @canonicalisation
  Scenario: Converse toolUse block without input leaks nothing
    Given a Bedrock trace whose assistant message carries a tool use block with a tool use id and name but no input
    When trace I/O is extracted
    Then the output text contains neither the tool use id nor the tool name

  @unit @canonicalisation
  Scenario: Converse toolResult block survives extraction
    Given a Bedrock trace whose user message carries a tool result with a text block
    When trace I/O is extracted
    Then the input text is the tool result's inner text

  @unit @canonicalisation
  Scenario: Converse toolResult json block survives extraction
    Given a Bedrock trace whose user message carries a tool result with a structured value
    When trace I/O is extracted
    Then the input text is the JSON of the tool result's structured content

  @unit @canonicalisation
  Scenario: Converse toolResult json:null block is preserved, not dropped
    Given a Bedrock trace whose user message carries a tool result with a null structured value
    When trace I/O is extracted
    Then the input text is the literal string "null"

  @unit @canonicalisation
  Scenario: Converse toolResult block with empty content contributes nothing
    Given a Bedrock trace whose user message carries a tool result whose content list is empty
    When trace I/O is extracted
    Then the input falls back to the span name
