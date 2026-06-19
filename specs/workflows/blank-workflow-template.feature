Feature: Blank workflow starts from the default prompt shape
  As a user creating a new workflow
  I want the starting LLM node to carry the standard prompt
  So that running it does not fail with an empty-messages error

  # Customer context: the blank workflow shipped an LLM node whose only message
  # referenced "question" and had no system prompt, which diverged from the
  # default new-prompt shape and ran into empty/invalid message errors. The
  # blank template now mirrors the default prompt: a "You are a helpful
  # assistant" system instruction, a single "{{input}}" user message, and an
  # "input" -> "output" wiring.

  @unit
  Scenario: Blank workflow entry exposes a single input
    Given the blank workflow template
    Then the entry point has a single "input" output

  @unit
  Scenario: Blank workflow LLM node uses the default assistant prompt
    Given the blank workflow template
    Then the LLM node instructions say "You are a helpful assistant"
    And the LLM node sends a single "{{input}}" user message

  @unit
  Scenario: Blank workflow wires the input through to the end output
    Given the blank workflow template
    Then the entry input is wired into the LLM node
    And the LLM output is wired into the end node output
