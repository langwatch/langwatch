# Metrics Display — Gherkin Spec
# Covers: drawer header metrics, span tab metrics, metric formatting, table cells, tooltips, comparison indicators

# ─────────────────────────────────────────────────────────────────────────────
# DRAWER HEADER — TRACE-LEVEL
# ─────────────────────────────────────────────────────────────────────────────

Feature: Metrics display

Rule: Trace-level drawer header
  The drawer header is composed of: row 1 (title row with back button, root-span-type badge, trace name, status dot, optional thread progress, and the right-side action cluster); row 2 (a single chip strip combining metric pills, source/tools chips, and "+N more" overflow); a dedicated pinned-context strip (auto-pins + custom pins, with overflow); and a mode-switch row (Trace / Conversation tabs) whose right end slot carries the presence avatars and relative timestamp.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace exists with spans and metrics

  Scenario: Title row shows the trace name with a status dot
    When the trace drawer opens
    Then row 1 shows the root-span-type badge (when set), the trace name (root span name) in monospace, and an 8px status dot
    And the status text appears next to the dot only when status is not "ok"

  Scenario: Title row provides the action cluster on the right
    When the trace drawer opens
    Then the right side of row 1 shows refresh, pin-drawer, maximize, overflow menu, and close buttons

  Scenario: Metric pills are co-located with chips in a single wrapping strip
    When the trace drawer opens for a trace with duration, cost, tokens, and model
    Then row 2 contains a Duration pill, a Spans pill, a Cost pill (when cost > 0), a Tokens pill (when total > 0), a Model pill (when models present), followed by the source/tools chips
    And the metric pills and chips are separated by thin pin dividers

  Scenario: TTFT pill appears when available
    Given the trace has time-to-first-token data
    When the trace drawer opens
    Then a TTFT pill is included in the chip strip

  Scenario: TTFT pill hides when unavailable
    Given the trace has no time-to-first-token data
    When the trace drawer opens
    Then no TTFT pill is rendered

  Scenario: Cost pill hides when there is no cost
    Given the trace's totalCost is 0 or null
    When the trace drawer opens
    Then no Cost pill is rendered

  Scenario: Model pill shows the abbreviated primary model only
    Given the trace uses model "openai/gpt-4o"
    When the trace drawer opens
    Then the Model pill shows "oai/4o"

  @planned
  # Not yet implemented as of 2026-05-01 — the drawer header Model pill always shows only `trace.models[0]` abbreviated. The "+N" badge with hover-tooltip listing every model is implemented in the trace-table ModelCell, not in the drawer header.
  Scenario: Model pill shows "+1" badge for traces with multiple models
    Given the trace uses models "gpt-4o" and "claude-sonnet"
    When the trace drawer opens
    Then the Model pill shows "openai/gpt-4o +1"
    And hovering the "+1" badge lists every model used

  Scenario: Mode-switch row carries presence and relative timestamp
    When the trace drawer opens
    Then the bottom row shows Trace / Conversation tabs
    And its right end slot shows the trace's presence avatars and a relative timestamp
    # Trace ID is no longer in the header — it lives behind the overflow menu / `Y` shortcut.

  Scenario: Timestamp shows the absolute time on hover
    When the user hovers the relative timestamp
    Then a tooltip shows the absolute timestamp


# ─────────────────────────────────────────────────────────────────────────────
# DRAWER HEADER — PROMOTED ATTRIBUTES
# ─────────────────────────────────────────────────────────────────────────────

Rule: Pinned attributes in drawer header
  The drawer renders a dedicated pinned-context strip below the metrics row. It contains hardcoded "auto-pins" (always inline when the underlying value exists) plus any user-pinned attributes.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace exists with spans and metrics

  Scenario: Auto-pins surface common identity / run / tag attributes when present
    Given the trace has values for any of: gen_ai.conversation.id, langwatch.user_id, scenario.run_id, evaluation.run_id, prompt selection / version, langwatch.labels
    When the trace drawer opens
    Then those values render as labelled pins ("Conversation", "User", "Scenario run", "Eval run", "Prompt", "Last prompt", "Prompt version", "Labels") in the pinned-context strip
    # Conversation / User / Run pins also resolve from top-level TraceHeader fields, not just raw attributes.

  Scenario: User-pinned attributes appear alongside auto-pins
    Given the user has pinned an attribute (e.g. "customer_id") via the Attributes accordion's pin icon
    When the trace drawer opens
    Then the pinned-context strip includes both auto-pins and custom pins
    And custom pins are capped at 3 inline; the rest roll into a "+N pinned" overflow popover

  Scenario: Conversation auto-pin is suppressed when the title row already shows a thread progress indicator
    Given the trace lives in a multi-turn conversation (conversationContext.total > 1)
    When the trace drawer opens
    Then the Conversation / Thread auto-pins are not rendered

  @planned
  # Not yet implemented as of 2026-05-01 — there is no "Configure" affordance on the pinned-context strip; users add/remove pins from the AttributeTable pin icons.
  Scenario: Configure link appears when using defaults
    Given the project has no user-pinned attributes
    When the trace drawer opens
    Then a "Configure" link appears on the pinned-context strip

  @planned
  # Not yet implemented as of 2026-05-01 — there is no fixed cap of five; auto-pins are always inline and custom pins use the 3-inline + overflow rule above.
  Scenario: Maximum of five promoted attributes are shown
    Given the project has six promoted attributes configured
    When the trace drawer opens
    Then only the first five promoted attributes appear on the pinned-context strip


# ─────────────────────────────────────────────────────────────────────────────
# SPAN TAB METRICS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Span tab metrics
  When a span is selected, an ephemeral (or pinned) span tab is added to the tab strip. The tab label is intentionally lean: name, type badge, optional abbreviated model (LLM only), duration, and an error dot when applicable. Cost, tokens, and TTFT are NOT shown on the span tab today — they live on the per-span IO/Attributes content.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace with multiple spans is open in the drawer

  Scenario: Selecting a span opens a span tab with inline label metadata
    When the user selects any span in the visualization
    Then a span tab appears in the tab bar
    And the tab shows the type badge, the span name (mono, truncated), the duration, and an error dot if the span errored

  Scenario: Drawer header remains at trace level when a span is selected
    When the user selects a span in the visualization
    Then the drawer header still shows trace-level identity and metrics

  Scenario: Closing the span tab returns to the Summary tab
    Given an ephemeral span tab is open
    When the user clicks the X button on the span tab
    Then the span tab closes
    And the view returns to the Summary tab

  Scenario: LLM span tab shows abbreviated model alongside duration
    When the user selects an LLM span with a model
    Then the span tab shows the abbreviated model name and duration (no cost / tokens / TTFT inline)

  Scenario: Non-LLM span tabs show only the duration
    When the user selects a Tool / Agent / RAG / Guardrail / Generic span
    Then the span tab shows only the duration on the label
    And the abbreviated model is omitted

  @planned
  # Not yet implemented as of 2026-05-01 — span tabs do not currently expose cost / tokens / aggregate cost / TTFT inline. Those numbers are only reachable via the per-span content (IOViewer + Attributes).
  Scenario: Per-span-type metric vocabulary on the span tab
    When the user selects a span
    Then the tab inline metrics match the type-specific vocabulary (LLM = duration + cost + tokens + model + TTFT; Agent = aggregate cost + tokens; etc.)


# ─────────────────────────────────────────────────────────────────────────────
# METRIC FORMATTING — DURATION
# ─────────────────────────────────────────────────────────────────────────────

Rule: Duration formatting
  Duration values use ms below 1000ms, otherwise X.Xs (one decimal). There is no minute formatting and no percentile-based color coding today.

  Scenario: Sub-millisecond duration rounds to "0ms"
    Given a span has a duration of 0.3 milliseconds
    Then the duration displays as "0ms"

  Scenario: Millisecond-range duration shows whole ms
    Given a span has a duration of 340 milliseconds
    Then the duration displays as "340ms"

  Scenario: Seconds-range duration shows one decimal place
    Given a span has a duration of 2300 milliseconds
    Then the duration displays as "2.3s"

  Scenario: Minutes-range duration still uses seconds with one decimal
    Given a span has a duration of 72 000 milliseconds
    Then the duration displays as "72.0s"

  Scenario: Long duration above 10 minutes still uses seconds with one decimal
    Given a span has a duration of 605 000 milliseconds
    Then the duration displays as "605.0s"

  @planned
  # Not yet implemented as of 2026-05-01 — formatDuration has no minute/hour formatting and no p50-based color coding. Status colors (ok/warning/error) are the only color treatment applied to duration today.
  Scenario: Minutes-range duration formatted as "Nm Ss"
    Given a span has a duration of 72 seconds
    Then the duration displays as "1m 12s"

  @planned
  # Not yet implemented as of 2026-05-01
  Scenario: Long duration above 10 minutes formatted as "Nm Ss"
    Given a span has a duration of 605 seconds
    Then the duration displays as "10m 5s"

  @planned
  # Not yet implemented as of 2026-05-01 — no service-p50 driven color coding exists.
  Scenario: Duration color coding relative to service p50
    Given the service p50 duration is 2 seconds
    Then a 1-second duration renders green, a 3-second duration uncolored, a 5-second duration yellow, and a 12-second duration red


# ─────────────────────────────────────────────────────────────────────────────
# METRIC FORMATTING — COST
# ─────────────────────────────────────────────────────────────────────────────

Rule: Cost formatting
  formatCost: returns "—" for $0 (or null), 4 decimal places below $0.01, otherwise 2 decimal places. An estimated cost is prefixed with "~".

  Scenario: Sub-cent cost shows four decimal places
    Given a trace has a cost of 0.003 dollars
    Then the cost displays as "$0.0030"

  Scenario: Cent-range cost shows two decimal places
    Given a trace has a cost of 0.04 dollars
    Then the cost displays as "$0.04"

  Scenario: Dollar-range cost shows two decimal places
    Given a trace has a cost of 1.24 dollars
    Then the cost displays as "$1.24"

  Scenario: High cost still uses two decimal places
    Given a trace has a cost of 142 dollars
    Then the cost displays as "$142.00"

  Scenario: Estimated cost shows tilde prefix
    Given a trace has an estimated cost of 0.003 dollars
    Then the cost displays as "~$0.0030"
    And hovering the Cost pill shows a tooltip noting "Cost is estimated from token counts" (only when authoritative tokens are absent)

  Scenario: Zero cost is rendered as an em-dash
    Given a trace has a cost of 0 dollars
    Then the cost displays as "—"
    And the Cost pill is not rendered in the drawer header


# ─────────────────────────────────────────────────────────────────────────────
# METRIC FORMATTING — COST HOVER BREAKDOWN
# ─────────────────────────────────────────────────────────────────────────────

Rule: Cost hover breakdown
  Hovering the cost pill shows a tooltip with the total cost and (when applicable) an "estimated from token counts" note.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the trace drawer is open

  Scenario: Cost tooltip shows the total
    When the user hovers the Cost pill
    Then a tooltip shows a single "Total" row with the formatted cost

  Scenario: Estimated cost tooltip shows footer note
    Given the trace has an estimated cost and no authoritative token counts
    When the user hovers the Cost pill
    Then the tooltip footer reads "Cost is estimated from token counts"

  @planned
  # Not yet implemented as of 2026-05-01 — the drawer header Cost tooltip does not break costs down by category. Per-category costs (input / output / cache read / cache write) are not surfaced anywhere in the trace-v2 drawer today.
  Scenario: Cost tooltip shows per-category breakdown
    Given the trace has input token cost, output token cost, and cache read cost
    When the user hovers the Cost pill
    Then a tooltip lists input / output / cache read / cache write costs and shows a total at the bottom


# ─────────────────────────────────────────────────────────────────────────────
# METRIC FORMATTING — TOKENS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Token formatting
  formatTokens: returns "—" for 0, "X.XK" at or above 1 000, otherwise the bare integer. There is no M (million) suffix; e.g. 1 200 000 renders as "1200.0K". The drawer header Tokens pill renders "{in} in · {out} out" when both numbers are present, otherwise the total token count.

  Scenario: Token count below 1000 shows exact number
    Given a trace has 520 input tokens and 380 output tokens
    Then the header Tokens pill shows "520 in · 380 out"

  Scenario: Token count at or above 1000 shows K suffix
    Given a trace has 1200 input tokens and 380 output tokens
    Then the header Tokens pill shows "1.2K in · 380 out"

  Scenario: Token count at or above 1 million still uses K (no M suffix)
    Given a trace has 1200000 input tokens and 500000 output tokens
    Then the header Tokens pill shows "1200.0K in · 500.0K out"

  @planned
  # Not yet implemented as of 2026-05-01 — formatTokens does not implement an M suffix; very large counts use K.
  Scenario: Token count formatted with M suffix above 1 million
    Given a trace has 1 200 000 input tokens and 500 000 output tokens
    Then the header Tokens pill shows "1.2M→500K"

  @planned
  # Not yet implemented as of 2026-05-01 — the trace table renders separate Cost / Token cells; the legacy combined "900" / "2K" total-token cell is not part of trace-v2.
  Scenario: Table cell shows combined token count
    Given a trace has 520 input tokens and 380 output tokens
    Then the table cell shows "900" as the combined token count


# ─────────────────────────────────────────────────────────────────────────────
# METRIC FORMATTING — TOKEN HOVER BREAKDOWN
# ─────────────────────────────────────────────────────────────────────────────

Rule: Token hover breakdown
  Hovering the Tokens pill shows a tooltip with Input, Output, optional Cache read, optional Cache write, a horizontal divider, and a Total row. When tokens are estimated and authoritative numbers are missing, a footer note "Tokens are estimated" appears.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the trace drawer is open

  Scenario: Token breakdown tooltip lists input, output, and total
    Given the trace has 520 input tokens, 380 output tokens, and no cache attributes
    When the user hovers the Tokens pill
    Then the tooltip shows rows for "Input" (520), "Output" (380), a divider, and "Total" (900)
    And no Cache read / Cache write rows are rendered

  Scenario: Token breakdown surfaces cache categories when present
    Given the trace's attributes include gen_ai.usage.cache_read.input_tokens and gen_ai.usage.cache_creation.input_tokens
    When the user hovers the Tokens pill
    Then the tooltip lists Input, Output, Cache read, and Cache write rows above the Total
    # The cache values come from raw attributes — they are not folded into the input count as a sub-item.

  Scenario: Token breakdown hides absent categories
    Given the trace has input and output tokens but no cache attributes
    When the user hovers the Tokens pill
    Then the tooltip does not show Cache read or Cache write lines


# ─────────────────────────────────────────────────────────────────────────────
# METRIC FORMATTING — MODEL
# ─────────────────────────────────────────────────────────────────────────────

Rule: Model display
  Model names are shown in abbreviated form via abbreviateModel(): provider gets a 3-letter abbreviation (oai/ant/ggl) and the model name is shortened (e.g. "gpt-4o" → "4o"). Models without a "/" are returned as-is.

  Scenario: Drawer header shows abbreviated provider/model
    Given a trace used the model "openai/gpt-4o"
    Then the header Model pill shows "oai/4o"

  Scenario: Trace table cell shows abbreviated provider/model
    Given a trace used the model "openai/gpt-4o"
    Then the table cell shows "oai/4o"

  Scenario: Trace table cell shows "+N" badge with full-list tooltip when multiple models
    Given a trace used "openai/gpt-4o" plus "anthropic/claude-sonnet"
    Then the trace-table Model cell shows the abbreviated primary model and a "+1" badge
    And hovering the badge lists all model strings in full

  @planned
  # Not yet implemented as of 2026-05-01 — the drawer header Model pill always shows only `models[0]` abbreviated and never a "+N" badge. The "+N" treatment exists only in the trace-table ModelCell.
  Scenario: Drawer header Model pill shows "+N" badge for multiple models
    Given a trace used "openai/gpt-4o" plus "anthropic/claude-sonnet"
    Then the header Model pill shows "oai/4o +1"

  Scenario: Non-LLM span hides model entirely
    Given a span has type "Tool" and no model
    Then no model pill or text is shown


# ─────────────────────────────────────────────────────────────────────────────
# METRIC FORMATTING — STATUS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Status display
  Status is shown as an 8px circle next to the trace name in the drawer header. The text label is rendered only for non-ok statuses (so "OK" never appears as a label).

  Scenario: OK status shows green dot only
    Given a trace completed successfully
    Then the status indicator shows a green 8px dot with no text label

  Scenario: Warning status shows yellow dot with capitalised label
    Given a trace completed but was flagged as a warning
    Then the status indicator shows a yellow 8px dot followed by "Warning"

  Scenario: Error status shows red dot with capitalised label
    Given a trace ended with an error
    Then the status indicator shows a red 8px dot followed by "Error"
    And the error message is available via the per-span Exceptions accordion


# ─────────────────────────────────────────────────────────────────────────────
# METRIC FORMATTING — TIME TO FIRST TOKEN
# ─────────────────────────────────────────────────────────────────────────────

Rule: Time to first token display
  TTFT is shown only at the drawer-header level today.

  Scenario: Trace-level TTFT pill from trace summary
    Given the trace's `ttft` field is populated
    When the trace drawer opens
    Then a TTFT pill is rendered in the header chip strip with the duration formatted via formatDuration()
    And the pill's tooltip reads "Time to First Token: <duration>"

  Scenario: TTFT hides when unavailable
    Given the trace has no `ttft` field
    When the trace drawer opens
    Then no TTFT pill is rendered

  @planned
  # Not yet implemented as of 2026-05-01 — the span tab label only shows duration (and abbreviated model on LLM spans). Per-span TTFT is not surfaced anywhere on the span tab today.
  Scenario: Span-level TTFT from span attribute
    Given an LLM span has a "gen_ai.server.time_to_first_token" attribute of 180 milliseconds
    When the user selects that span
    Then the span tab shows TTFT as "180ms"


# ─────────────────────────────────────────────────────────────────────────────
# TABLE CELL FORMATTING
# ─────────────────────────────────────────────────────────────────────────────

Rule: Trace table metric cells
  Metrics in the trace table use compact formatting and monospace alignment.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the trace table is visible with traces

  Scenario: Duration cell shows the formatted value in a monospace cell
    Then each duration cell shows the value formatted by formatDuration() inside a MonoCell (no icon prefix)

  Scenario: Cost cell shows the formatted value in a monospace cell
    Then each cost cell shows the value formatted by formatCost() (with the "~" prefix when tokens are estimated)

  @planned
  # Not yet implemented as of 2026-05-01 — trace-table Cost cells do not currently render a per-row breakdown tooltip.
  Scenario: Cost cell shows hover breakdown
    Then hovering a cost cell shows the cost breakdown tooltip

  Scenario: Tokens cell shows combined total in K when ≥1000
    Then each tokens cell shows the value formatted by formatTokens() against the row's totalTokens (K-suffix only — no M)

  @planned
  # Not yet implemented as of 2026-05-01 — trace-table Tokens cells do not currently render a per-row breakdown tooltip.
  Scenario: Token cell shows hover breakdown
    Then hovering a token cell shows the token breakdown tooltip

  Scenario: Model cell shows abbreviated provider/model
    Then each model cell shows the abbreviated value (e.g. "oai/4o") with a "+N" badge for additional models

  Scenario: Status cell shows a colored indicator only (no text)
    Then each status cell shows only a colored StatusIndicator dot

  Scenario: TTFT column has its own optional cell
    Then a TtftCell is registered and shows formatDuration(ttft) or "—" when null
    And whether it appears by default depends on the active column configuration

  Scenario: Numeric cells use monospace alignment
    Then duration, cost, tokens, and TTFT cells use the MonoCell wrapper for vertical alignment across rows


# ─────────────────────────────────────────────────────────────────────────────
# TOOLTIP BEHAVIOR
# ─────────────────────────────────────────────────────────────────────────────

Rule: Metric tooltip behavior
  All metric tooltips follow consistent positioning and styling rules.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the trace drawer is open

  Scenario: Tooltips use the shared Tooltip primitive
    When the user hovers any metric pill
    Then the tooltip is rendered through the shared `~/components/ui/tooltip` wrapper with the configured `placement`

  Scenario: TTFT pill tooltip explains the metric
    When the user hovers the TTFT pill
    Then the tooltip reads "Time to First Token: <duration>"

  Scenario: Tooltip dismisses on mouse leave
    Given a metric tooltip is visible
    When the user moves the mouse away from the pill
    Then the tooltip dismisses without needing a click

  @planned
  # Not yet implemented as of 2026-05-01 — viewport-edge flip / shift heuristics are delegated to the underlying tooltip primitive's defaults; we don't assert custom behavior in tests today.
  Scenario: Tooltip stays within viewport near bottom edge
    Given the cost pill is near the bottom of the viewport
    When the user hovers the cost pill
    Then the tooltip flips to appear above the pill instead of below

  @planned
  # Not yet implemented as of 2026-05-01
  Scenario: Tooltip stays within viewport near right edge
    Given a metric pill is near the right edge of the viewport
    When the user hovers the pill
    Then the tooltip shifts left to stay within the viewport

  @planned
  # Not yet implemented as of 2026-05-01
  Scenario: Tooltip does not clip outside drawer boundaries
    When the user hovers any metric pill
    Then the tooltip does not extend beyond the drawer boundaries


# ─────────────────────────────────────────────────────────────────────────────
# COMPARISON INDICATORS (FUTURE)
# ─────────────────────────────────────────────────────────────────────────────

Rule: Comparison indicators
  Space is reserved for comparative indicators next to metrics in a future phase.

  Scenario: Phase 1 shows raw metric values without comparison
    When the trace drawer opens
    Then metric pills show only raw values
    And no comparison indicators like "2.1x avg" or "30% cheaper" are shown
