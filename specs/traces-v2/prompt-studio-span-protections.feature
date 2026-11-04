Feature: The playground reads a span through the viewer's protections
  As a project member opening an LLM span in the prompt playground
  I get the same content protections and visibility window the trace drawer applies
  So that the playground never shows content the drawer would hide (#8549)

  Both reads behind spans.getForPromptStudio follow one rule: a link naming
  the trace and a link naming only the span. The playground opens the captured
  conversation as an editable prompt, so content the viewer may not read is
  refused rather than opened half-redacted.

  @unit
  Scenario: A viewer who may not read captured input is refused the span
    Given a viewer the project's privacy settings hide captured input from
    When they open an LLM span in the playground
    Then the span is refused as withheld content
    And no span content is read

  @unit
  Scenario: A viewer a privacy rule hides any content category from is refused the span
    Given a privacy rule that hides system instructions from the viewer
    When they open an LLM span in the playground
    Then the span is refused as withheld content

  @unit
  Scenario: A span older than the plan's visibility window is refused
    Given a plan whose visibility window starts after the span started
    When the viewer opens the span in the playground
    Then the span is refused as outside the visibility window

  @unit
  Scenario: A span inside the plan's visibility window opens in full
    Given a plan whose visibility window starts at or before the span's start
    When the viewer opens the span in the playground
    Then the span opens with its messages and prompt variables

  @unit
  Scenario: An attribute a policy hides from the viewer is not read into the prompt
    Given an attribute policy that hides the prompt variables from the viewer
    When they open an LLM span in the playground
    Then the span opens without the hidden values
