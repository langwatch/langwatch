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
    Given messages whose content is [{text: ...}] with no type field
    When trace I/O is extracted
    Then the trace summary shows the real prompt and completion

  @unit @canonicalisation
  Scenario: Converse toolUse block survives extraction
    Given a gen_ai.completion message whose content is [{toolUse: {name, input}}]
    When trace I/O is extracted
    Then the output text contains the JSON of the tool call's input

  @unit @canonicalisation
  Scenario: Converse toolUse block without input leaks nothing
    Given a gen_ai.completion message whose content is [{toolUse: {toolUseId, name}}]
    When trace I/O is extracted
    Then the output text contains neither the tool use id nor the tool name

  @unit @canonicalisation
  Scenario: Converse toolResult block survives extraction
    Given a gen_ai.prompt message whose content is [{toolResult: {content: [{text}]}}]
    When trace I/O is extracted
    Then the input text is the tool result's inner text

  @unit @canonicalisation
  Scenario: Converse toolResult json block survives extraction
    Given a gen_ai.prompt message whose content is [{toolResult: {content: [{json}]}}]
    When trace I/O is extracted
    Then the input text is the JSON of the tool result's structured content

  @unit @canonicalisation
  Scenario: Converse toolResult json:null block is preserved, not dropped
    Given a gen_ai.prompt message whose content is [{toolResult: {content: [{json: null}]}}]
    When trace I/O is extracted
    Then the input text is the literal string "null"

  @unit @canonicalisation
  Scenario: Converse toolResult block with empty content contributes nothing
    Given a gen_ai.prompt message whose content is [{toolResult: {content: []}}]
    When trace I/O is extracted
    Then the input falls back to the span name
