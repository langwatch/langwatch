# Span View — Gherkin Spec
# Based on PRD-006: Span View (Span Tab)
# Covers: span tab activation/closing, tab label, I/O accordion, attributes accordion,
#         exceptions accordion, events accordion, evals accordion, auto-open rules,
#         data gating, keyboard navigation, relationship to Trace Summary

# ─────────────────────────────────────────────────────────────────────────────
# SPAN TAB ACTIVATION AND CLOSING
# ─────────────────────────────────────────────────────────────────────────────

Feature: Span view

Rule: Span tab activation
  Clicking a span in the visualization opens a span tab showing span-level data.

  Background:
    Given the user is viewing a trace with multiple spans
    And the Trace Summary tab is active

  Scenario: Clicking a span opens the span tab
    When the user clicks a span in the visualization
    Then a span tab appears in the tab bar next to the Trace Summary tab
    And the span tab becomes active
    And the accordion content switches to span-level data with a fade animation

  Scenario: Visualization keeps the selected span highlighted
    When the user clicks a span in the visualization
    Then the visualization remains visible
    And the selected span is highlighted in the visualization

  Scenario: Clicking a different span updates the span tab
    Given a span tab is open for span "llm.openai.chat"
    When the user clicks a different span "tool.search_documents" in the visualization
    Then the span tab updates to show data for "tool.search_documents" with a fade animation

  Scenario: Clicking the same span closes the span tab
    Given a span tab is open for a span
    When the user clicks the same span again in the visualization
    Then the span tab closes
    And the Trace Summary tab becomes active with a fade animation

  Scenario: Clicking the close button on the span tab returns to Trace Summary
    Given a span tab is open
    When the user clicks the x button on the span tab
    Then the span tab closes
    And the Trace Summary tab becomes active with a fade animation

  Scenario: Pressing Escape closes the span tab
    Given a span tab is open
    When the user presses Escape
    Then the span tab closes
    And the Trace Summary tab becomes active

  Scenario: Clicking empty space in the visualization closes the span tab
    Given a span tab is open
    When the user clicks empty space in the visualization
    Then the span tab closes
    And the Trace Summary tab becomes active

  Scenario: Switching to Trace Summary preserves the span tab
    Given a span tab is open
    When the user clicks the Trace Summary tab
    Then the Trace Summary tab becomes active
    And the span tab remains in the tab bar
    And the user can click the span tab to return to it

  Scenario: Arrow keys navigate between spans
    Given a span tab is open
    When the user presses arrow keys in the span tree
    Then the span tab updates to show data for the newly focused span

  Scenario: Pressing O switches to Trace Summary tab
    Given a span tab is open
    When the user presses the O key
    Then the Trace Summary tab becomes active


# ─────────────────────────────────────────────────────────────────────────────
# SPAN TAB LABEL
# ─────────────────────────────────────────────────────────────────────────────

Rule: Span tab label
  The span tab shows span identity and key metrics inline.

  Background:
    Given the user is viewing a trace
    And a span tab is open

  Scenario: Tab label shows span name
    Then the span tab displays the span name

  Scenario: Tab label shows truncated span ID with copy
    Then the span tab shows the span ID truncated to 8 characters in monospace muted text
    And hovering the span ID reveals the full span ID
    And a copy-to-clipboard button is shown next to the span ID

  Scenario: Tab label shows colored span type badge for an LLM span
    Given the selected span is of type LLM
    Then the span tab shows a blue "LLM" badge

  Scenario: Tab label shows colored span type badge for a Tool span
    Given the selected span is of type Tool
    Then the span tab shows a green "Tool" badge

  Scenario: Tab label shows colored span type badge for an Agent span
    Given the selected span is of type Agent
    Then the span tab shows a purple "Agent" badge

  Scenario: Tab label shows colored span type badge for a RAG span
    Given the selected span is of type RAG
    Then the span tab shows an orange "RAG" badge

  Scenario: Tab label shows colored span type badge for a Guardrail span
    Given the selected span is of type Guardrail
    Then the span tab shows a yellow "Guardrail" badge

  Scenario: Tab label shows colored span type badge for a generic span
    Given the selected span is of type Span
    Then the span tab shows a gray "Span" badge

  Scenario: Tab label shows inline metrics for LLM span
    Given the selected span is of type LLM with duration, cost, and model
    Then the span tab shows duration, cost, and model inline

  Scenario: Non-applicable metrics are hidden, not shown as dashes
    Given the selected span is of type Tool
    Then the span tab shows duration
    And the span tab does not show model or tokens

  Scenario: Tab label shows error dot for errored span
    Given the selected span has an error status
    Then the span tab shows an error dot indicator


# ─────────────────────────────────────────────────────────────────────────────
# I/O ACCORDION
# ─────────────────────────────────────────────────────────────────────────────

Rule: Span I/O accordion
  Shows the selected span's input and output with format toggles.

  Background:
    Given the user is viewing a trace
    And a span tab is open

  Scenario: I/O accordion is open by default for LLM spans
    Given the selected span is of type LLM
    Then the I/O accordion is open

  Scenario: I/O accordion is open by default for Tool spans
    Given the selected span is of type Tool with input arguments and return value
    Then the I/O accordion is open

  Scenario: I/O accordion shows input and output sections
    Given the selected span has input and output
    Then the I/O accordion shows an INPUT section with the span's input
    And an OUTPUT section with the span's output

  Scenario: Format toggle switches between Pretty, Text, and JSON
    Given the I/O accordion is open with structured data
    Then the default view is Pretty with rich rendering and formatting
    When the user selects Text
    Then the raw string representation is shown
    When the user selects JSON
    Then the raw JSON with syntax highlighting is shown

  Scenario: Copy-to-clipboard per I/O section
    Given the I/O accordion is open
    Then a copy-to-clipboard button is available for the input section
    And a copy-to-clipboard button is available for the output section

  Scenario: Long content is truncated with expand option
    Given the I/O accordion is open with long content
    Then the content is truncated
    And a "Show full" expander is available to reveal the complete content

  Scenario: Missing input shows placeholder
    Given the selected span has no input captured
    Then the INPUT section shows "No input captured for this span."

  Scenario: Missing output shows placeholder
    Given the selected span has no output captured
    Then the OUTPUT section shows "No output captured for this span."


# ─────────────────────────────────────────────────────────────────────────────
# ATTRIBUTES ACCORDION
# ─────────────────────────────────────────────────────────────────────────────

Rule: Span attributes accordion
  Shows span and resource attributes as key-value pairs with Flat and JSON views.

  Background:
    Given the user is viewing a trace
    And a span tab is open

  Scenario: Attributes accordion is closed by default for LLM spans
    Given the selected span is of type LLM
    Then the Attributes accordion is closed

  Scenario: Attributes accordion auto-opens for non-LLM spans with no I/O
    Given the selected span is a non-LLM span with no input or output
    Then the Attributes accordion is open
    And the I/O accordion is closed

  Scenario: Attributes show span attributes and resource attributes sections
    When the user opens the Attributes accordion
    Then a "Span Attributes" section is shown
    And a "Resource Attributes" section is shown

  Scenario: Flat view shows dot-concatenated keys sorted alphabetically
    When the user opens the Attributes accordion
    Then the default view is Flat
    And each attribute is shown as a row with a monospace muted key and monospace value
    And the keys are dot-concatenated and sorted alphabetically
    And each row has a copy button

  Scenario: JSON view reconstitutes nested objects from dot-separated keys
    When the user switches to JSON view in the Attributes accordion
    Then dot-separated keys are reconstituted into nested JSON objects
    And the JSON is syntax highlighted
    And nodes are collapsible
    And a copy-all button is available

  Scenario: Search filters attributes by key or value
    When the user types in the attribute search input
    Then only attributes matching the search term by key or value are shown

  Scenario: Long attribute values are truncated with expand option
    Given an attribute has a long value
    Then the value is truncated
    And a "Show full" expander is available

  Scenario: Empty attribute values show a dash
    Given an attribute has an empty value
    Then the value is displayed as a dash

  Scenario: No attributes shows placeholder
    Given the selected span has no attributes
    Then the Attributes accordion shows "No attributes recorded"
    And the Attributes accordion is closed


# ─────────────────────────────────────────────────────────────────────────────
# EXCEPTIONS ACCORDION
# ─────────────────────────────────────────────────────────────────────────────

Rule: Span exceptions accordion
  Shows exceptions originating from the selected span only.

  Background:
    Given the user is viewing a trace
    And a span tab is open

  Scenario: Exceptions accordion is hidden when span has no exceptions
    Given the selected span has no exception events
    Then the Exceptions accordion is not rendered

  Scenario: Exceptions accordion appears with count when span has errors
    Given the selected span has 2 exception events
    Then the Exceptions accordion is rendered with "(2)" in the header

  Scenario: Exceptions accordion auto-opens for errored spans
    Given the selected span has error status
    Then the Exceptions accordion is open automatically

  Scenario: Exception displays type, message, and collapsible stack trace
    Given the Exceptions accordion is open
    Then each exception shows an error icon, exception type, and message
    And each exception has a collapsible stack trace block

  Scenario: No span origin link is shown in span-level exceptions
    Given the Exceptions accordion is open
    Then no "from [span name]" link is shown for any exception


# ─────────────────────────────────────────────────────────────────────────────
# EVENTS ACCORDION
# ─────────────────────────────────────────────────────────────────────────────

Rule: Span events accordion
  Shows informational events originating from the selected span only.

  Background:
    Given the user is viewing a trace
    And a span tab is open

  Scenario: Events accordion is hidden when span has no events
    Given the selected span has no events
    Then the Events accordion is not rendered

  Scenario: Events accordion appears with count when span has events
    Given the selected span has 3 events
    Then the Events accordion is rendered with "(3)" in the header

  Scenario: Event displays name, timestamp offset, and attributes
    Given the Events accordion is open
    Then each event shows the event name, timestamp offset, and attributes

  Scenario: User feedback events appear in span events
    Given the selected span has a user feedback event targeting it
    Then the user feedback event appears in the Events accordion

  Scenario: No span origin link is shown in span-level events
    Given the Events accordion is open
    Then no "from [span name]" link is shown for any event


# ─────────────────────────────────────────────────────────────────────────────
# EVALS ACCORDION
# ─────────────────────────────────────────────────────────────────────────────

Rule: Span evals accordion
  Shows evaluation results that ran on the selected span only.

  Background:
    Given the user is viewing a trace
    And a span tab is open

  Scenario: Evals accordion is hidden when span has no eval results
    Given the selected span has no evaluation results
    Then the Evals accordion is not rendered

  Scenario: Evals accordion appears with count when span has evals
    Given the selected span has 1 evaluation result
    Then the Evals accordion is rendered with "(1)" in the header

  Scenario: Eval results use compact card format with sparkline
    Given the Evals accordion is open
    Then each eval result is shown in a compact 2-line card format
    And each card includes a run history sparkline or dots

  Scenario: No span origin link is shown in span-level evals
    Given the Evals accordion is open
    Then no "from [span name]" link is shown for any eval


# ─────────────────────────────────────────────────────────────────────────────
# ACCORDION ORDER AND AUTO-OPEN RULES
# ─────────────────────────────────────────────────────────────────────────────

Rule: Span accordion ordering and auto-open behavior
  Accordions follow a fixed order and auto-open based on span context.

  Background:
    Given the user is viewing a trace
    And a span tab is open

  Scenario: Accordion order is fixed
    Then the accordions appear in order: I/O, Attributes, Exceptions, Events, Evals

  Scenario: Multiple accordions can be open at the same time
    When the user opens both the I/O and Attributes accordions
    Then both accordions remain open simultaneously

  Scenario: LLM span opens I/O and closes Attributes
    Given the selected span is of type LLM without errors
    Then the I/O accordion is open
    And the Attributes accordion is closed
    And the Exceptions accordion is closed if present
    And the Events accordion is closed if present
    And the Evals accordion is closed if present

  Scenario: Tool span opens I/O and closes Attributes
    Given the selected span is of type Tool without errors
    Then the I/O accordion is open
    And the Attributes accordion is closed

  Scenario: Non-LLM span with no I/O opens Attributes
    Given the selected span is a non-LLM span with no input or output
    Then the I/O accordion is closed
    And the Attributes accordion is open

  Scenario: Span with error opens I/O and Exceptions
    Given the selected span has error status
    Then the I/O accordion is open
    And the Exceptions accordion is open

  Scenario: Span with failed eval opens I/O and Evals
    Given the selected span has a failed evaluation result
    Then the I/O accordion is open
    And the Evals accordion is open


# ─────────────────────────────────────────────────────────────────────────────
# DATA GATING
# ─────────────────────────────────────────────────────────────────────────────

Rule: Span view data gating
  Missing data is handled with placeholders or hidden accordions.

  Background:
    Given the user is viewing a trace
    And a span tab is open

  Scenario: No input or output shows placeholder text
    Given the selected span has no input and no output
    Then the I/O accordion shows "No input captured for this span." and "No output captured for this span."
    And the I/O accordion is closed

  Scenario: No attributes shows placeholder text
    Given the selected span has no attributes recorded
    Then the Attributes accordion shows "No attributes recorded"
    And the Attributes accordion is closed

  Scenario: No exceptions hides the accordion entirely
    Given the selected span has no exception events
    Then the Exceptions accordion is not rendered

  Scenario: No events hides the accordion entirely
    Given the selected span has no events
    Then the Events accordion is not rendered

  Scenario: No evals hides the accordion entirely
    Given the selected span has no evaluation results
    Then the Evals accordion is not rendered

  Scenario: Non-LLM span hides model and token metrics from tab label
    Given the selected span is not of type LLM
    Then the span tab label does not show model or token metrics


# ─────────────────────────────────────────────────────────────────────────────
# RELATIONSHIP TO TRACE SUMMARY
# ─────────────────────────────────────────────────────────────────────────────

Rule: Span view relationship to Trace Summary
  The span tab shows span-scoped data while Trace Summary shows trace-wide data.

  Background:
    Given the user is viewing a trace with 3 spans, each with exceptions

  Scenario: Trace Summary shows all exceptions across all spans
    When the user views the Trace Summary tab
    Then the Exceptions accordion shows all exceptions from all spans
    And each exception has a "from [span name]" link

  Scenario: Span tab shows only exceptions from the selected span
    When the user clicks a span that has 1 exception
    Then the span tab Exceptions accordion shows only that 1 exception
    And no "from [span name]" link is shown

  Scenario: Switching between Trace Summary and span tab preserves both views
    Given a span tab is open showing 1 exception
    When the user clicks the Trace Summary tab
    Then the Trace Summary shows all exceptions across the trace
    When the user clicks the span tab
    Then the span tab still shows only the 1 exception from the selected span
