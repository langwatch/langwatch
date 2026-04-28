# Metrics Display — Gherkin Spec
# Based on PRD-008: Metrics Display
# Covers: drawer header metrics, span tab metrics, metric formatting, table cells, tooltips, comparison indicators

# ─────────────────────────────────────────────────────────────────────────────
# DRAWER HEADER — TRACE-LEVEL
# ─────────────────────────────────────────────────────────────────────────────

Feature: Trace-level drawer header
  The drawer header shows identity and key metrics for the current trace.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace exists with spans and metrics

  Scenario: Header shows trace ID on line 0
    When the trace drawer opens
    Then line 0 shows the trace ID truncated to 8 characters in monospace muted text
    And a copy-to-clipboard button is shown next to the trace ID
    And hovering the trace ID shows the full ID in a tooltip

  Scenario: Header shows trace name and status on line 1
    When the trace drawer opens
    Then line 1 shows the root span name as the trace name
    And a status badge with a colored dot and text appears on the right

  Scenario: Header shows key metrics as compact pills on line 2
    When the trace drawer opens for a trace with duration, cost, tokens, and model
    Then line 2 shows a duration pill
    And a cost pill
    And a tokens pill in input-arrow-output format
    And a model pill

  Scenario: TTFT pill appears when available
    Given the trace has time-to-first-token data
    When the trace drawer opens
    Then a TTFT pill appears on line 2

  Scenario: TTFT pill hides when unavailable
    Given the trace has no time-to-first-token data
    When the trace drawer opens
    Then no TTFT pill appears on line 2

  Scenario: Cost pill shows estimated prefix when cost is estimated
    Given the trace has an estimated cost
    When the trace drawer opens
    Then the cost pill shows a tilde prefix before the value

  Scenario: Model pill shows primary model when trace uses multiple models
    Given the trace uses models "gpt-4o" and "claude-sonnet"
    And "gpt-4o" consumed the most tokens
    When the trace drawer opens
    Then the model pill shows "gpt-4o +1"

  Scenario: Model badge hover lists all models used
    Given the trace uses models "gpt-4o", "claude-sonnet", and "gpt-5-mini"
    When the user hovers the "+2" badge on the model pill
    Then a tooltip lists all three models

  Scenario: Header shows context tags on line 3
    When the trace drawer opens
    Then line 3 shows context tags as key-value pills with attribute names visible
    And a relative timestamp appears at the end of line 3

  Scenario: Timestamp shows absolute time on hover
    When the user hovers the relative timestamp on line 3
    Then a tooltip shows the absolute timestamp


# ─────────────────────────────────────────────────────────────────────────────
# DRAWER HEADER — PROMOTED ATTRIBUTES
# ─────────────────────────────────────────────────────────────────────────────

Feature: Promoted attributes in drawer header
  Users can pin trace or span attributes to always appear in the header.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace exists with spans and metrics

  Scenario: Default promoted attributes appear when none are configured
    Given the project has no custom promoted attributes configured
    When the trace drawer opens
    Then line 3 shows "service.name", "deployment.environment", and "service.version" as key-value pills

  Scenario: Configure link appears when using defaults
    Given the project has no custom promoted attributes configured
    When the trace drawer opens
    Then a subtle "Configure" link appears on line 3

  Scenario: Custom promoted attributes replace defaults
    Given the project has promoted attributes "customer_id" and "prompt_version" configured
    When the trace drawer opens
    Then line 3 shows the "customer_id" and "prompt_version" values as key-value pills

  Scenario: Maximum of five promoted attributes are shown
    Given the project has six promoted attributes configured
    When the trace drawer opens
    Then only the first five promoted attributes appear on line 3


# ─────────────────────────────────────────────────────────────────────────────
# SPAN TAB METRICS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Span tab metrics
  When a span is selected, its metrics appear in a tab rather than replacing the header.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace with multiple spans is open in the drawer

  Scenario: Selecting a span opens a span tab with inline metrics
    When the user selects an LLM span in the visualization
    Then a span tab appears in the tab bar
    And the tab shows the span name, type badge, and key metrics inline

  Scenario: Drawer header remains at trace level when a span is selected
    When the user selects a span in the visualization
    Then the drawer header still shows trace-level identity and metrics

  Scenario: Closing the span tab returns to trace summary
    Given a span tab is open
    When the user clicks the close button on the span tab
    Then the span tab closes
    And the view returns to the Trace Summary tab

  Scenario: LLM span tab shows all applicable metrics
    When the user selects an LLM span
    Then the span tab shows duration, cost, tokens, model, and TTFT

  Scenario: Tool span tab shows only duration
    When the user selects a Tool span
    Then the span tab shows duration
    And does not show cost, tokens, model, or TTFT

  Scenario: Agent span tab shows duration and aggregate cost and tokens
    When the user selects an Agent span
    Then the span tab shows duration, aggregate cost, and aggregate tokens
    And does not show model or TTFT

  Scenario: RAG span tab shows only duration
    When the user selects a RAG span
    Then the span tab shows duration
    And does not show cost, tokens, model, or TTFT

  Scenario: Guardrail span tab shows duration, cost, tokens, and model
    When the user selects a Guardrail span
    Then the span tab shows duration, cost, tokens, and model
    And does not show TTFT

  Scenario: Generic span tab shows only duration
    When the user selects a Generic span
    Then the span tab shows duration
    And does not show cost, tokens, model, or TTFT


# ─────────────────────────────────────────────────────────────────────────────
# METRIC FORMATTING — DURATION
# ─────────────────────────────────────────────────────────────────────────────

Feature: Duration formatting
  Duration values are formatted with appropriate units based on magnitude.

  Scenario: Sub-millisecond duration
    Given a span has a duration of 0.3 milliseconds
    Then the duration displays as "0.3ms"

  Scenario: Millisecond-range duration
    Given a span has a duration of 340 milliseconds
    Then the duration displays as "340ms"

  Scenario: Seconds-range duration
    Given a span has a duration of 2.3 seconds
    Then the duration displays as "2.3s"

  Scenario: Minutes-range duration
    Given a span has a duration of 72 seconds
    Then the duration displays as "1m 12s"

  Scenario: Long duration above 10 minutes
    Given a span has a duration of 605 seconds
    Then the duration displays as "10m 5s"

  Scenario: Duration color coding for fast spans
    Given the service p50 duration is 2 seconds
    And a span has a duration of 1 second
    Then the duration text has a green color

  Scenario: Duration has no color coding within normal range
    Given the service p50 duration is 2 seconds
    And a span has a duration of 3 seconds
    Then the duration text has no special color

  Scenario: Duration color coding for slow spans
    Given the service p50 duration is 2 seconds
    And a span has a duration of 5 seconds
    Then the duration text has a yellow color

  Scenario: Duration color coding for very slow spans
    Given the service p50 duration is 2 seconds
    And a span has a duration of 12 seconds
    Then the duration text has a red color


# ─────────────────────────────────────────────────────────────────────────────
# METRIC FORMATTING — COST
# ─────────────────────────────────────────────────────────────────────────────

Feature: Cost formatting
  Cost values are formatted with appropriate decimal places based on magnitude.

  Scenario: Sub-cent cost shows three decimal places
    Given a trace has a cost of 0.003 dollars
    Then the cost displays as "$0.003"

  Scenario: Cent-range cost shows two decimal places
    Given a trace has a cost of 0.04 dollars
    Then the cost displays as "$0.04"

  Scenario: Dollar-range cost shows two decimal places
    Given a trace has a cost of 1.24 dollars
    Then the cost displays as "$1.24"

  Scenario: High cost shows no decimal places
    Given a trace has a cost of 142 dollars
    Then the cost displays as "$142"

  Scenario: Estimated cost shows tilde prefix
    Given a trace has an estimated cost of 0.003 dollars
    Then the cost displays as "~$0.003"
    And hovering the cost pill shows a tooltip with "Cost estimated from token count"

  Scenario: Zero cost is shown explicitly
    Given a trace has a cost of 0 dollars
    Then the cost displays as "$0.000"


# ─────────────────────────────────────────────────────────────────────────────
# METRIC FORMATTING — COST HOVER BREAKDOWN
# ─────────────────────────────────────────────────────────────────────────────

Feature: Cost hover breakdown
  Hovering the cost pill shows a detailed breakdown tooltip.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the trace drawer is open

  Scenario: Cost breakdown tooltip shows per-category costs
    Given the trace has input token cost, output token cost, and cache read cost
    When the user hovers the cost pill
    Then a tooltip shows a "Cost Breakdown" heading
    And lists input tokens cost, output tokens cost, and cache read cost
    And shows a total at the bottom

  Scenario: Cost breakdown hides zero-value categories
    Given the trace has input token cost and output token cost but no cache costs
    When the user hovers the cost pill
    Then the tooltip does not show cache read or cache write lines

  Scenario: Estimated cost breakdown shows footer note
    Given the trace has an estimated cost
    When the user hovers the cost pill
    Then the tooltip footer shows "Estimated from token count"


# ─────────────────────────────────────────────────────────────────────────────
# METRIC FORMATTING — TOKENS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Token formatting
  Token counts are formatted with K/M suffixes and displayed in split or combined form.

  Scenario: Token count below 1000 shows exact number
    Given a span has 520 input tokens and 380 output tokens
    Then the header token pill shows "520→380"

  Scenario: Token count at or above 1000 shows K suffix
    Given a span has 1200 input tokens and 380 output tokens
    Then the header token pill shows "1.2K→380"

  Scenario: Token count at or above 1 million shows M suffix
    Given a span has 1200000 input tokens and 500000 output tokens
    Then the header token pill shows "1.2M→500K"

  Scenario: Table cell shows combined token count
    Given a trace has 520 input tokens and 380 output tokens
    Then the table cell shows "900" as the combined token count

  Scenario: Table cell shows combined token count with K suffix
    Given a trace has 1200 input tokens and 800 output tokens
    Then the table cell shows "2K" as the combined token count


# ─────────────────────────────────────────────────────────────────────────────
# METRIC FORMATTING — TOKEN HOVER BREAKDOWN
# ─────────────────────────────────────────────────────────────────────────────

Feature: Token hover breakdown
  Hovering the token pill shows a detailed breakdown tooltip.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the trace drawer is open

  Scenario: Token breakdown tooltip shows input and output with cache sub-breakdowns
    Given the trace has 520 input tokens with 380 cache read tokens and 380 output tokens
    When the user hovers the token pill
    Then a tooltip shows a "Token Breakdown" heading
    And lists input count with cache read as a sub-item
    And lists output count
    And shows a total at the bottom

  Scenario: Token breakdown hides absent categories
    Given the trace has input and output tokens but no cache tokens
    When the user hovers the token pill
    Then the tooltip does not show cache read or cache write lines


# ─────────────────────────────────────────────────────────────────────────────
# METRIC FORMATTING — MODEL
# ─────────────────────────────────────────────────────────────────────────────

Feature: Model display
  Model names are shown in full or abbreviated form depending on context.

  Scenario: Header shows provider and model name
    Given a trace used the model "gpt-4o" from "openai"
    Then the header model pill shows "openai/gpt-4o"

  Scenario: Table cell shows abbreviated model name
    Given a trace used the model "gpt-4o" from "openai"
    Then the table cell shows "oai/4o"

  Scenario: Multiple models show primary plus count badge
    Given a trace used "gpt-4o" with the most tokens and also used "claude-sonnet"
    Then the header model pill shows "openai/gpt-4o +1"

  Scenario: Non-LLM span hides model entirely
    Given a span has type "Tool" and no model
    Then no model pill or text is shown


# ─────────────────────────────────────────────────────────────────────────────
# METRIC FORMATTING — STATUS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Status display
  Status is shown as a colored dot with optional text.

  Scenario: OK status shows green dot
    Given a trace completed successfully
    Then the status badge shows a green 8px dot with text "OK"

  Scenario: Warning status shows yellow dot
    Given a trace completed but was flagged as slow
    Then the status badge shows a yellow 8px dot

  Scenario: Error status shows red dot and error is available
    Given a trace ended with an error
    Then the status badge shows a red 8px dot
    And the error message is available in the drawer


# ─────────────────────────────────────────────────────────────────────────────
# METRIC FORMATTING — TIME TO FIRST TOKEN
# ─────────────────────────────────────────────────────────────────────────────

Feature: Time to first token display
  TTFT is shown for LLM spans and at trace level when available.

  Scenario: Trace-level TTFT from trace summaries
    Given the trace has a TTFT value from the first LLM span
    When the trace drawer opens
    Then the TTFT pill shows the value formatted like duration

  Scenario: Span-level TTFT from span attribute
    Given an LLM span has a "gen_ai.server.time_to_first_token" attribute of 180 milliseconds
    When the user selects that span
    Then the span tab shows TTFT as "180ms"

  Scenario: TTFT hides when unavailable
    Given a trace has no TTFT data
    When the trace drawer opens
    Then no TTFT pill is shown


# ─────────────────────────────────────────────────────────────────────────────
# TABLE CELL FORMATTING
# ─────────────────────────────────────────────────────────────────────────────

Feature: Trace table metric cells
  Metrics in the trace table use compact formatting and monospace alignment.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the trace table is visible with traces

  Scenario: Duration cell shows value without icon
    Then each duration cell shows a compact value like "1.2s" without an icon prefix

  Scenario: Cost cell shows value with hover breakdown
    Then each cost cell shows a compact value like "$0.003"
    And hovering a cost cell shows the cost breakdown tooltip

  Scenario: Token cell shows combined count with hover breakdown
    Then each token cell shows a combined count like "1.2K"
    And hovering a token cell shows the token breakdown tooltip

  Scenario: Model cell shows very short abbreviation
    Then each model cell shows an abbreviated label like "4o"

  Scenario: Status cell shows colored dot only
    Then each status cell shows only a colored dot without text

  Scenario: TTFT column is hidden by default
    Then the TTFT column is not visible in the default table configuration

  Scenario: Numeric cells use monospace font for alignment
    Then duration, cost, and token cells use monospace text for vertical alignment across rows


# ─────────────────────────────────────────────────────────────────────────────
# TOOLTIP BEHAVIOR
# ─────────────────────────────────────────────────────────────────────────────

Feature: Metric tooltip behavior
  All metric tooltips follow consistent positioning and styling rules.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the trace drawer is open

  Scenario: Tooltip stays within viewport near bottom edge
    Given the cost pill is near the bottom of the viewport
    When the user hovers the cost pill
    Then the tooltip flips to appear above the pill instead of below

  Scenario: Tooltip stays within viewport near right edge
    Given a metric pill is near the right edge of the viewport
    When the user hovers the pill
    Then the tooltip shifts left to stay within the viewport

  Scenario: Tooltip does not clip outside drawer boundaries
    When the user hovers any metric pill
    Then the tooltip does not extend beyond the drawer boundaries

  Scenario: Tooltips use consistent dark styling
    When the user hovers any metric pill
    Then the tooltip has a dark background with light text and a subtle arrow pointer

  Scenario: Tooltips include a brief explanatory label
    When the user hovers the TTFT pill
    Then the tooltip includes a label explaining the metric

  Scenario: Tooltip dismisses on mouse leave
    Given a metric tooltip is visible
    When the user moves the mouse away from the pill
    Then the tooltip dismisses
    And it does not require a click to close


# ─────────────────────────────────────────────────────────────────────────────
# COMPARISON INDICATORS (FUTURE)
# ─────────────────────────────────────────────────────────────────────────────

Feature: Comparison indicators
  Space is reserved for comparative indicators next to metrics in a future phase.

  Scenario: Phase 1 shows raw metric values without comparison
    When the trace drawer opens
    Then metric pills show only raw values
    And no comparison indicators like "2.1x avg" or "30% cheaper" are shown
