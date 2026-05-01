# Span View — Gherkin Spec
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
    Then an ephemeral span tab appears in the tab bar after the Summary / LLM-Optimized / Prompts tabs
    And the span tab becomes active
    And the accordion content switches to span-level data

  Scenario: Visualization keeps the selected span highlighted
    When the user clicks a span in the visualization
    Then the visualization remains visible
    And the selected span is highlighted in the visualization

  Scenario: Clicking a different span updates the span tab
    Given a span tab is open for span "llm.openai.chat"
    When the user clicks a different span "tool.search_documents" in the visualization
    Then the (ephemeral) span tab now shows data for "tool.search_documents"

  Scenario: Clicking the same span in the Waterfall or Span List closes the span tab
    Given a span tab is open for a span
    And the user is in the Waterfall or Span List view
    When the user clicks that same span again
    Then the span tab closes
    And the Summary tab becomes active

  Scenario: Clicking the X on the ephemeral span tab returns to Summary
    Given an ephemeral span tab is open
    When the user clicks the X button on the span tab
    Then the span tab closes and the Summary tab becomes active

  Scenario: Pinning a span tab makes it persistent
    Given an ephemeral span tab is open
    When the user clicks the pin icon on the span tab
    Then the span becomes a pinned span tab that survives selecting a different span
    And selecting another span opens a separate ephemeral span tab alongside the pinned one

  Scenario: Many pinned spans collapse into a "+N more" overflow menu
    Given more than 4 spans are pinned as tabs
    Then the first 3 pinned spans render inline and the rest collapse into a "+N more" dropdown

  @planned
  # Not yet implemented as of 2026-05-01 — Esc is consumed by Flame view (resets zoom / clears selection there) and by the drawer-level cascade, but there is no global "Esc closes the span tab" handler.
  Scenario: Pressing Escape closes the span tab
    Given a span tab is open
    When the user presses Escape
    Then the span tab closes
    And the Summary tab becomes active

  @planned
  # Not yet implemented as of 2026-05-01 — Waterfall has no click-to-clear empty-space handler. (Flame view does clear selection on empty-space click.)
  Scenario: Clicking empty space in the Waterfall closes the span tab
    Given a span tab is open
    When the user clicks empty space in the Waterfall view
    Then the span tab closes
    And the Summary tab becomes active

  Scenario: Switching to the Summary tab preserves the open span tab
    Given a span tab is open
    When the user clicks the Summary tab
    Then the Summary tab becomes active
    And the span tab remains in the tab bar
    And the user can click the span tab to return to it

  @planned
  # Not yet implemented as of 2026-05-01 — span tab updates with arrow keys only inside the Flame view's keyboard navigation, not as a generic span-tree shortcut.
  Scenario: Arrow keys navigate between spans
    Given a span tab is open
    When the user presses arrow keys in the span tree
    Then the span tab updates to show data for the newly focused span

  Scenario: Pressing O switches to the Summary tab
    Given a span tab is open
    When the user presses the O key
    Then the Summary tab becomes active


# ─────────────────────────────────────────────────────────────────────────────
# SPAN TAB LABEL
# ─────────────────────────────────────────────────────────────────────────────

Rule: Span tab label
  The span tab shows span identity and key metrics inline.

  Background:
    Given the user is viewing a trace
    And a span tab is open

  Scenario: Tab label shows span name in monospace
    Then the span tab displays the span name in monospace, truncated at ~180px wide, with a tooltip showing the full name and span ID

  Scenario: Tab label shows colored span type badge for an LLM span
    Given the selected span is of type LLM
    Then the span tab shows a blue "LLM" badge (colorPalette blue)

  Scenario: Tab label shows colored span type badge for a Tool span
    Given the selected span is of type Tool
    Then the span tab shows a green "Tool" badge (colorPalette green)

  Scenario: Tab label shows colored span type badge for an Agent span
    Given the selected span is of type Agent
    Then the span tab shows a purple "Agent" badge (colorPalette purple)

  Scenario: Tab label shows colored span type badge for a RAG span
    Given the selected span is of type RAG
    Then the span tab shows an "RAG" badge (colorPalette orange in tabs)

  Scenario: Tab label shows colored span type badge for a Guardrail span
    Given the selected span is of type Guardrail
    Then the span tab shows a "Guardrail" badge (colorPalette yellow in tabs)

  Scenario: Tab label shows a gray badge for a generic span
    Given the selected span is of type "span" / "chain" / "module"
    Then the span tab shows a gray badge with that type label

  Scenario: Tab label shows abbreviated model and duration for LLM spans
    Given the selected span is of type LLM with a model
    Then the span tab shows the abbreviated model name and the formatted duration inline (cost is not displayed inline on the tab)

  Scenario: Non-LLM tab labels show only duration
    Given the selected span is not of type LLM
    Then the span tab shows the formatted duration only (no model)

  Scenario: Tab label shows error dot for errored span
    Given the selected span has an error status
    Then the span tab shows a 6px red circle indicator


# ─────────────────────────────────────────────────────────────────────────────
# I/O ACCORDION
# ─────────────────────────────────────────────────────────────────────────────

Rule: Span "Input and Output" accordion
  A single accordion section ("Input and Output") that contains stacked Input and Output IOViewer panels, each with their own format toggle. The combined section auto-opens whenever the span has either input or output captured.

  Background:
    Given the user is viewing a trace
    And a span tab is open

  Scenario: Input and Output accordion auto-opens when there is any I/O
    Given the selected span has any input or output captured
    Then the "Input and Output" accordion is open by default

  Scenario: Input and Output accordion shows Input then Output panels
    Given the selected span has both input and output
    Then the section renders an "Input" IOViewer panel followed by an "Output" IOViewer panel

  Scenario: Format toggle switches between Pretty, Text, JSON, and Markdown
    Given an IOViewer panel is open with structured data
    Then the default view is Pretty
    When the user selects Text
    Then the raw string representation is shown
    When the user selects JSON
    Then the raw JSON with syntax highlighting is shown
    When the user selects Markdown
    Then the content is rendered as markdown (toggleable to source)

  Scenario: Copy-to-clipboard per panel
    Given an IOViewer panel is open
    Then a copy-to-clipboard button is available within that panel

  Scenario: Long content is truncated with an expander
    Given an IOViewer panel has more than 100 000 characters of content (with at least 1 000 characters of tail)
    Then the content is sliced to the first 100 000 characters with "…" appended
    And a "Show more" / "Show less" toggle is available

  Scenario: Missing I/O hides the panels and shows a single placeholder
    Given the selected span has no input and no output
    Then the section shows "No I/O captured for this span"
    # The current implementation uses a single combined message — there are no separate
    # "No input captured for this span." / "No output captured for this span." placeholders.


# ─────────────────────────────────────────────────────────────────────────────
# ATTRIBUTES ACCORDION
# ─────────────────────────────────────────────────────────────────────────────

Rule: Span attributes accordion
  Shows span and resource attributes as key-value pairs with Flat and JSON views.

  Background:
    Given the user is viewing a trace
    And a span tab is open

  Scenario: Attributes accordion auto-opens whenever the span has its own attributes
    Given the selected span has any span-level attributes recorded
    Then the Attributes accordion is open by default
    # Auto-open is content-driven via useAutoOpenSections — every populated section opens by
    # default (regardless of span type). Resource-only attributes do NOT trigger auto-open.

  Scenario: Section header shows attribute leaf count
    Then the Attributes accordion header includes the count of flattened leaves across span + resource attributes

  Scenario: Span and Resource attributes sub-sections
    When the user opens the Attributes accordion
    And both span and resource attributes exist
    Then a "Span Attributes" sub-section is shown above a "Resource Attributes" sub-section
    # When only span attributes exist, the sub-section title is rendered without a label.

  Scenario: Flat view shows dot-concatenated keys sorted alphabetically with pinned keys first
    When the user opens the Attributes accordion
    Then the default view is "flat"
    And each attribute is shown as a row with a monospace key and a pretty-printed value
    And the keys are dot-concatenated and sorted alphabetically, with currently pinned keys hoisted above the rest

  Scenario: JSON view reconstitutes nested objects from dot-separated keys
    When the user switches to "json" view in the Attributes accordion
    Then dot-separated keys are reconstituted into nested JSON objects
    And the JSON is syntax highlighted with collapsible nodes

  Scenario: Copy-all button copies the merged attributes payload
    When the user clicks the copy button in the Attributes accordion toolbar
    Then the merged span + resource attributes JSON is copied to the clipboard

  Scenario: Search filters attributes by key or value
    When the user types in the attribute filter input
    Then only attributes whose key or stringified value matches (case-insensitive) the search term remain visible

  Scenario: Pin a single attribute to the trace header
    When the user clicks the pin icon on an attribute row
    Then that attribute is added to the project's pinned attributes
    And it appears in the drawer header's pinned-context strip

  Scenario: Empty attribute values show an em-dash
    Given an attribute has a null, undefined, or empty-string value
    Then the value is displayed as an em-dash

  Scenario: No attributes shows placeholder
    Given the selected span has no attributes
    Then the Attributes accordion content reads "No additional attributes recorded"


# ─────────────────────────────────────────────────────────────────────────────
# EXCEPTIONS ACCORDION
# ─────────────────────────────────────────────────────────────────────────────

Rule: Span Exceptions accordion
  Shows the single error message + stacktrace attached to the selected span (when one exists). The accordion is rendered only when the span is errored.

  Background:
    Given the user is viewing a trace
    And a span tab is open

  Scenario: Exceptions accordion is hidden when span is not errored
    Given the selected span has no error status and no exception details
    Then the Exceptions accordion is not rendered

  Scenario: Exceptions accordion auto-opens for errored spans
    Given the selected span has error status
    Then the Exceptions accordion is rendered and open by default

  Scenario: Exception block displays the message and a stacktrace pre-block
    Given the Exceptions accordion is open with error details
    Then a red banner shows the error icon and the exception message
    And, when a stacktrace exists, it renders below as a scrollable monospace pre-block (already-expanded, not behind a collapse toggle)

  Scenario: No span origin link is shown in span-level exceptions
    Given the Exceptions accordion is open
    Then no "from [span name]" link is shown

  @planned
  # Not yet implemented as of 2026-05-01 — only one error per span is surfaced (message + stacktrace), so no count badge exists.
  Scenario: Exceptions header shows count for spans with multiple exceptions
    Given the selected span has 2 exception events
    Then the Exceptions accordion is rendered with "(2)" in the header


# ─────────────────────────────────────────────────────────────────────────────
# EVENTS ACCORDION
# ─────────────────────────────────────────────────────────────────────────────

Rule: Span Events accordion
  Always rendered for the selected span. Shows informational events originating from the span (or an empty-state when none).

  Background:
    Given the user is viewing a trace
    And a span tab is open

  Scenario: Events accordion is always rendered
    Then an "Events" accordion is present in the span sections
    # The section is rendered even when empty — it shows an EmptyEventsState in that case.

  Scenario: Events accordion shows count when span has events
    Given the selected span has 3 events
    Then the Events accordion header includes count "3"

  Scenario: Event displays name and offset from span start
    Given the Events accordion is open with events
    Then each event row shows the event name and a "+Nms" offset relative to the span's start time

  Scenario: No span origin link is shown in span-level events
    Given the Events accordion is open
    Then no "from [span name]" link is shown for any event

  @planned
  # Not yet implemented as of 2026-05-01 — span event rows do not currently render per-event attributes inline.
  Scenario: Event displays attributes
    Given the Events accordion is open
    Then each event row shows its attributes inline

  @planned
  # Not yet implemented as of 2026-05-01 — user-feedback events are not surfaced in the span-level Events list.
  Scenario: User feedback events appear in span events
    Given the selected span has a user feedback event targeting it
    Then the user feedback event appears in the Events accordion


# ─────────────────────────────────────────────────────────────────────────────
# EVALS ACCORDION
# ─────────────────────────────────────────────────────────────────────────────

@planned
# Not yet implemented as of 2026-05-01 — the span tab today renders I/O, Prompt, Attributes, Exceptions, and Events. Evaluations live on the trace summary view, not on a per-span accordion.
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

  Scenario: Accordion order
    Then the accordions appear in order: Input and Output, Prompt (when prompt metadata exists), Attributes, Events
    And when the span is errored: Exceptions appears before Input and Output if there is no I/O, otherwise immediately after Input and Output

  Scenario: Multiple accordions can be open at the same time
    When the user opens multiple accordions
    Then all opened accordions remain open simultaneously

  Scenario: Auto-open is content-driven (not span-type-driven)
    When a span tab opens
    Then every section that has content is auto-opened (I/O if present, Attributes if span has its own attributes, Prompt if prompt metadata, Exceptions if errored, Events if any) — the user's subsequent manual toggles are preserved while staying on the same span

  Scenario: Non-LLM span with no I/O still opens Attributes when span has attributes
    Given the selected span is a non-LLM span with no input or output and has attributes
    Then the Input and Output accordion is closed
    And the Attributes accordion is open

  Scenario: Errored span with no I/O surfaces Exceptions first
    Given the selected span has error status and no I/O
    Then the Exceptions section is rendered before the Input and Output section

  @planned
  # Not yet implemented as of 2026-05-01 — no per-span Evals section exists.
  Scenario: Span with failed eval opens Evals
    Given the selected span has a failed evaluation result
    Then the Evals accordion is open


# ─────────────────────────────────────────────────────────────────────────────
# DATA GATING
# ─────────────────────────────────────────────────────────────────────────────

Rule: Span view data gating
  Missing data is handled with placeholders or hidden accordions.

  Background:
    Given the user is viewing a trace
    And a span tab is open

  Scenario: No input or output shows a single placeholder
    Given the selected span has no input and no output
    Then the Input and Output accordion shows "No I/O captured for this span"
    And the section is closed by default

  Scenario: No attributes shows placeholder text
    Given the selected span has no span or resource attributes
    Then the Attributes accordion content reads "No additional attributes recorded"

  Scenario: No exceptions hides the accordion entirely
    Given the selected span has no error and no exception details
    Then the Exceptions accordion is not rendered

  Scenario: Events accordion is always rendered (empty-state when no events)
    Given the selected span has no events
    Then the Events accordion is rendered with an empty-state message

  @planned
  # Not yet implemented as of 2026-05-01 — no per-span Evals section exists.
  Scenario: No evals hides the accordion entirely
    Given the selected span has no evaluation results
    Then the Evals accordion is not rendered

  Scenario: Non-LLM span hides model from tab label
    Given the selected span is not of type LLM
    Then the span tab label does not show a model name (token counts are never shown on the tab label)


# ─────────────────────────────────────────────────────────────────────────────
# RELATIONSHIP TO TRACE SUMMARY
# ─────────────────────────────────────────────────────────────────────────────

Rule: Span view relationship to Summary tab
  The span tab shows span-scoped data while the Summary tab shows trace-wide data.

  Background:
    Given the user is viewing a trace with 3 spans, each with exceptions

  Scenario: Span tab shows only the exception from the selected span
    When the user clicks a span that has an error
    Then the span tab Exceptions accordion shows only that span's error message and stacktrace
    And no "from [span name]" link is shown

  Scenario: Switching between Summary and span tab preserves both views
    Given a span tab is open showing 1 exception
    When the user clicks the Summary tab
    Then the Summary content is shown without losing the span tab
    When the user clicks the span tab again
    Then the span tab still shows only the exception from the selected span

  @planned
  # Not yet implemented as of 2026-05-01 — the Summary tab's exceptions section / "from [span name]" link surface is part of the trace-summary spec; this scenario is asserted there once that section lands. Today there is no consolidated exceptions list with span-origin links.
  Scenario: Summary tab shows all exceptions across all spans with span-origin links
    When the user views the Summary tab
    Then the Exceptions accordion shows all exceptions from all spans
    And each exception has a "from [span name]" link
