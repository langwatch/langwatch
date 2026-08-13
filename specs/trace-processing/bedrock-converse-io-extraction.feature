Feature: Bedrock Converse span I/O extraction
  As an operator viewing traces from AWS Bedrock instrumentation
  I want Converse-shaped payloads to reach the trace summary input/output
  So that Bedrock traces don't read as empty (or as span-name/HTTP noise)
  while the real content sits unread in span attributes.

  # Why this exists — langwatch-saas#1040 (Branch 1)
  #
  # None of the registered canonicalisation extractors read AWS Bedrock
  # payload keys, and the Converse API's content-block union is
  # discriminated by WHICH KEY IS PRESENT ({text}, {toolUse}, {toolResult})
  # rather than a `type` field, so tool turns were dropped even when the
  # messages sat under canonical gen_ai.* keys. The degradation was
  # asymmetric and easy to miss: input fell back to the root span's name,
  # output to the HTTP status or nothing.
  #
  # Note: this gap did NOT cause the Healify empty traces in #1040 — those
  # spans carry no payload attributes at all (producer-side omission).

  Background:
    Given the canonicalisation pipeline runs before trace I/O extraction

  @unit @canonicalisation
  Scenario: Converse toolUse block survives extraction
    Given a gen_ai.completion message whose content is [{toolUse: {name, input}}]
    When trace I/O is extracted
    Then the output text contains the JSON of the tool call's input

  @unit @canonicalisation
  Scenario: Converse toolResult block survives extraction
    Given a gen_ai.prompt message whose content is [{toolResult: {content: [{text}]}}]
    When trace I/O is extracted
    Then the input text is the tool result's inner text

  @unit @canonicalisation
  Scenario: aws.bedrock.* payload keys are mapped to canonical keys
    Given a span with aws.bedrock.request.messages and aws.bedrock.response.output
    When the BedrockExtractor canonicalises the span
    Then gen_ai.input.messages and gen_ai.output.messages are written
    And the trace summary shows the real prompt and completion

  @unit @canonicalisation
  Scenario: Mapped messages beat the HTTP fallback
    Given an HTTP-instrumented Bedrock span with aws.bedrock.request.messages
    When trace I/O is extracted
    Then the input is the request message text, not "POST /model/.../converse"
