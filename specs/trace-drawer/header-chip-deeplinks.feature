Feature: Trace drawer header chips deep-link into summary sections with a blue glow

  As an operator triaging a trace in the v2 explorer drawer
  I want the error status pill and evaluation chips in the header to take me
  directly to the relevant accordion section on the Summary tab,
  with a brief blue glow on arrival so I don't lose the section in a busy panel.

  Background:
    The drawer header surfaces a compact strip of chips (status, evals,
    pinned attributes). When an operator clicks one of these chips it
    publishes a one-shot focus request through `useFocusSectionStore`.
    The `TraceSummaryAccordions` observer expands the matching section,
    scrolls it into view, and the section briefly pulses with a blue
    ring so the eye lands on it. The same observer wires the
    "Exceptions", "Evals", and "Events" sections.

  # ---------------------------------------------------------------------------
  # Error status chip
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Clicking the error status chip focuses the Exceptions section
    Given a trace whose status is "error" and at least one span recorded an exception
    And the drawer header is visible with the red "Error" status chip
    When the operator clicks the status chip
    Then the drawer switches to the Summary tab
    And the Exceptions accordion expands if it was collapsed
    And the Exceptions accordion is scrolled into view
    And the Exceptions accordion briefly pulses with the shared trace-drawer focus glow

  @integration @unimplemented
  Scenario: Hovering the error status chip surfaces an interactive exceptions preview
    Given a trace whose status is "error" and four spans recorded errors
    And the drawer header is visible
    When the operator hovers over the status chip
    Then a popover opens showing the trace-level error message in the same red treatment as the Exceptions section
    And the popover lists one button per error span, in the same deepest-first order the Exceptions section uses
    When the operator clicks one of the span buttons inside the popover
    Then the drawer switches to the span detail tab for that span
    And the popover closes

  # ---------------------------------------------------------------------------
  # Evaluation chip
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Clicking an evaluation chip focuses the Evals section
    Given a trace with at least one completed evaluation
    And the drawer header is visible with an evaluation chip
    When the operator clicks the evaluation chip
    Then the drawer switches to the Summary tab
    And the Evals accordion expands if it was collapsed
    And the Evals accordion is scrolled into view
    And the Evals accordion briefly pulses with the shared trace-drawer focus glow

  # ---------------------------------------------------------------------------
  # Glow shape contract — keeps light/dark variants from drifting
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The focus glow runs a single short pulse so the eye lands without distracting
    Given a section is targeted via a focus request
    When the glow plays
    Then it runs for roughly one and a half seconds before fading out
    And it does not loop forever like the onboarding tour glow
    And it never blocks subsequent focus requests for the same section
