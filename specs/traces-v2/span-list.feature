# Span List — Gherkin Spec
# Covers: columns, sorting, filtering, aggregates, duplicate spans, cross-view linking, interactions, performance, data gating

# ─────────────────────────────────────────────────────────────────────────────
# COLUMNS AND LAYOUT
# ─────────────────────────────────────────────────────────────────────────────

Feature: Span list

Rule: Span list columns
  The span list displays every span in a trace as a flat, sortable table.

  Background:
    Given the user is viewing a trace with multiple spans
    And the Span List view is selected

  Scenario: All default columns are visible
    Then the table shows columns Name, Type, Duration, Model, Status, and Start
    # Cost and Tokens columns were removed because the span tree payload doesn't carry them
    # (those numbers live on the heavier per-span detail query — see columns.ts).

  Scenario: Name column displays full span name in monospace
    Then each span name is rendered in monospace font
    And long names truncate within the cell with the full name available via the row tooltip

  Scenario: Type column shows colored badges
    Then each span displays its type as a colored badge
    And the badge label is the span type uppercased (LLM, TOOL, AGENT, RAG, GUARDRAIL, EVALUATION, CHAIN, SPAN)

  Scenario: Duration column formats values by magnitude
    Given a span with duration 1100ms
    And a span with duration 340ms
    And a span with duration 0ms
    Then durations display as "1.1s", "340ms", and "<1ms" respectively

  Scenario: Model column shows the trailing segment of the model id
    Given an LLM span using model "openai/gpt-4o"
    And a Tool span with no model
    Then models display as "gpt-4o" and an em-dash respectively

  Scenario: Status column shows a colored dot
    Given a span with OK status
    And a span with Error status
    Then each status displays as an 8px circle in the per-status color
    And the column header has no label (only an icon-sized cell)

  Scenario: Start column shows offset from trace start
    Given a span starting at the same time as the trace
    And a span starting 340ms after the trace
    And a span starting 1200ms after the trace
    Then start times display as "+0ms", "+340ms", and "+1.2s" respectively

# ─────────────────────────────────────────────────────────────────────────────
# COLUMN VISIBILITY
# ─────────────────────────────────────────────────────────────────────────────

Rule: Span list column visibility
  Redundant columns can be hidden when filtering to a single type.

  Background:
    Given the user is viewing a trace with multiple span types
    And the Span List view is selected

  Scenario: All columns visible by default
    Then all six columns are visible

  Scenario: Type column hides when filtered to a single type
    When the user filters to only LLM spans
    Then the Type column is hidden

  Scenario: Type column reappears when filter is cleared
    Given the user has filtered to only LLM spans
    When the user clears the type filter
    Then the Type column is visible again

# ─────────────────────────────────────────────────────────────────────────────
# SORTING
# ─────────────────────────────────────────────────────────────────────────────

Rule: Span list sorting
  Users can sort spans by any column to answer specific questions.

  Background:
    Given the user is viewing a trace with multiple spans
    And the Span List view is selected

  Scenario: Default sort is duration descending
    Then spans are sorted by Duration in descending order
    And the Duration column header shows a descending arrow indicator

  Scenario: Clicking a column header sorts by that column
    When the user clicks the Name column header
    Then spans are sorted by Name alphabetically
    And the Name column header shows a sort arrow indicator

  Scenario: Clicking the same column header toggles sort direction
    Given spans are sorted by Duration descending
    When the user clicks the Duration column header
    Then spans are sorted by Duration in ascending order
    And the arrow indicator changes to ascending

  Scenario: Secondary sort by start time when primary values are equal
    Given two spans with the same duration
    Then those spans are ordered by start time ascending

  Scenario: Status sort orders by status string
    When the user sorts by Status
    Then spans are ordered by status string (the actual order depends on locale string compare of "ok" / "error" / "warning")

  Scenario: Zero-millisecond spans sort as zero
    Given a span with 0ms duration
    When spans are sorted by Duration ascending
    Then the 0ms span appears first

# ─────────────────────────────────────────────────────────────────────────────
# TYPE FILTER
# ─────────────────────────────────────────────────────────────────────────────

Rule: Span list type filter
  Type filtering uses an inline chip strip above the table — one chip per type that appears in the trace, plus an "All" chip. Chips are click-to-toggle and compose multi-select.

  Background:
    Given the user is viewing a trace with 2 LLM spans, 1 Tool span, 1 Agent span, and 1 Guardrail span
    And the Span List view is selected

  Scenario: All chip is active by default
    Then the "All" chip shows "(5)" and is the active chip
    And all 5 spans are visible in the table

  Scenario: Type chips show counts per type
    Then each type chip shows its span count
    And LLM shows count "2" and TOOL shows count "1"

  Scenario: Clicking a type chip toggles that type into the filter
    When the user clicks the LLM chip
    Then only LLM spans are visible in the table
    And the LLM chip becomes active and the "All" chip becomes inactive

  Scenario: Multi-select adds another type to the filter
    When the user clicks LLM, then clicks TOOL
    Then LLM and TOOL spans are visible
    And AGENT and GUARDRAIL spans are hidden

  Scenario: Clicking the All chip clears the type filter
    Given the user has LLM and TOOL active
    When the user clicks the "All" chip
    Then all individual type selections are cleared
    And all spans are visible

# ─────────────────────────────────────────────────────────────────────────────
# NAME SEARCH
# ─────────────────────────────────────────────────────────────────────────────

Rule: Span list name search
  Users can search spans by name to find specific spans quickly.

  Background:
    Given the user is viewing a trace with spans named "llm.openai.chat", "llm.summarize", "tool.search_docs", "guardrail.pii_check", and "agent.run"
    And the Span List view is selected

  Scenario: Search input is visible
    Then a search input with placeholder "Filter spans..." is visible

  Scenario: Typing filters spans by substring match
    When the user types "llm" in the search input
    Then only "llm.openai.chat" and "llm.summarize" are visible

  Scenario: Search is case-insensitive
    When the user types "LLM" in the search input
    Then only "llm.openai.chat" and "llm.summarize" are visible

  Scenario: Clearing search restores all spans
    Given the user has typed "llm" in the search input
    When the user clears the search input
    Then all 5 spans are visible

# ─────────────────────────────────────────────────────────────────────────────
# COMBINED FILTERS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Span list combined filters
  Type filter and name search compose together to narrow results.

  Background:
    Given the user is viewing a trace with spans of various types and names
    And the Span List view is selected

  Scenario: Type filter and name search compose
    Given the trace has LLM spans "llm.openai.chat" and "llm.summarize" and a Tool span "tool.chat_lookup"
    When the user selects LLM in the Type filter
    And the user types "chat" in the search input
    Then only "llm.openai.chat" is visible

# ─────────────────────────────────────────────────────────────────────────────
# SPAN COUNT DISPLAY
# ─────────────────────────────────────────────────────────────────────────────

Rule: Span list count display
  The span count always shows how many spans match the current filters.

  Background:
    Given the user is viewing a trace with 5 spans
    And the Span List view is selected

  Scenario: Unfiltered count shows total
    Then the span count reads "5 spans"

  Scenario: Filtered count shows matching and total
    When the user filters to only LLM spans and 2 match
    Then the span count reads "2 of 5 spans"

# ─────────────────────────────────────────────────────────────────────────────
# FOOTER AGGREGATES
# ─────────────────────────────────────────────────────────────────────────────

Rule: Span list footer aggregates
  A footer row shows totals for the visible spans.

  Background:
    Given the user is viewing a trace with multiple spans
    And the Span List view is selected

  Scenario: Unfiltered footer shows trace duration only
    Then the footer Name cell reads "Totals:"
    And the footer Duration cell shows the trace total duration suffixed with "*" and a tooltip "Trace duration"
    # Cost and tokens are not summarized in the footer because the table no longer has those columns.

  Scenario: Filtered footer shows the duration span of filtered rows
    When the user filters to only LLM spans
    Then the footer Name cell reads "Filtered totals:"
    And the footer Duration cell shows (max(end) − min(start)) of the filtered rows with a tooltip "Sum of filtered spans"

# ─────────────────────────────────────────────────────────────────────────────
# DUPLICATE SPAN NAMES
# ─────────────────────────────────────────────────────────────────────────────

Rule: Span list duplicate span names
  Traces with duplicate span names are handled naturally by the flat table.

  Background:
    Given the user is viewing a trace with 3 spans all named "tool.search"
    And the Span List view is selected

  Scenario: Each duplicate span is its own row
    Then the table shows 3 separate rows for "tool.search"

  Scenario: Start time differentiates same-named spans
    Then each "tool.search" row has a distinct Start column value

  Scenario: Sorting by name clusters same-named spans
    When the user sorts by Name
    Then the 3 "tool.search" rows appear consecutively
    And they are secondarily sorted by start time

  Scenario: Span ID shown on hover tooltip
    When the user hovers over a "tool.search" row
    Then a tooltip shows "Span ID: <first 16 chars of spanId>"
    And the span ID is not shown as a table column

  Scenario: No artificial index numbers
    Then the table does not append index numbers like "#1", "#2", "#3" to span names

# ─────────────────────────────────────────────────────────────────────────────
# CROSS-VIEW LINKING FROM WATERFALL
# ─────────────────────────────────────────────────────────────────────────────

Rule: Span list cross-view linking
  Sibling groups in the waterfall can open in the span list for comparison.

  Background:
    Given the user is viewing a trace in the waterfall view
    And the trace has a grouped siblings row "Scenario Turn x77" of type Agent

  Scenario: Clicking view in span list opens pre-filtered span list
    When the user clicks the "view in Span List" link on the sibling group
    Then the Span List view opens
    And the name search is pre-filled with "Scenario Turn"
    And the Type filter is set to Agent

  Scenario: Pre-filtered span list shows all grouped spans as rows
    Given the user clicked "view in Span List" on "Scenario Turn x77"
    Then the table shows 77 rows for "Scenario Turn"
    And the rows are sortable by any column

# ─────────────────────────────────────────────────────────────────────────────
# ROW INTERACTIONS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Span list row interactions
  Users can interact with rows to select spans and see details.

  Background:
    Given the user is viewing a trace with multiple spans
    And the Span List view is selected

  Scenario: Clicking a row selects the span
    When the user clicks a span row
    Then that span is selected
    And the span detail tab opens

  Scenario: Hovering a row highlights it
    When the user hovers over a span row
    Then the row shows a subtle highlight

  Scenario: Clicking the same row again clears the selection
    Given a row is currently selected
    When the user clicks that same row again
    Then the selection is cleared and the span tab closes

  Scenario: Hovering a row shows span ID tooltip
    When the user hovers over a span row
    Then a tooltip displays the span ID

# ─────────────────────────────────────────────────────────────────────────────
# PERFORMANCE
# ─────────────────────────────────────────────────────────────────────────────

Rule: Span list performance
  The span list handles large traces efficiently with virtualization.

  Scenario: All trace sizes use row virtualization
    Given any trace size
    When the Span List view is selected
    Then visible rows are rendered and off-screen rows are recycled by the virtualizer (overscan ~10)

  @planned
  # Not yet implemented as of 2026-05-01 — there is no "Load more" gate; virtualization handles all sizes from a fully-loaded list.
  Scenario: Large traces show load-more threshold
    Given a trace with more than 500 spans
    When the Span List view is selected
    Then the first 200 spans are shown
    And a message reads "Showing first 200 of N. Load more."

  @planned
  # Not yet implemented as of 2026-05-01
  Scenario: Loading more spans in a large trace
    Given a trace with more than 500 spans
    And the first 200 spans are shown
    When the user clicks "Load more"
    Then additional spans are loaded into the table

# ─────────────────────────────────────────────────────────────────────────────
# DATA GATING AND EDGE CASES
# ─────────────────────────────────────────────────────────────────────────────

Rule: Span list data gating
  The span list handles missing data and edge cases gracefully.

  Background:
    Given the Span List view is selected

  Scenario: Single-span trace shows one row
    Given a trace with exactly one span
    Then the table shows a single row with that span's data

  Scenario: Missing model shows an em-dash
    Given a span with no model
    Then the Model cell displays an em-dash
    And the column is not hidden

  Scenario: All spans filtered out shows empty message
    Given the user has applied filters that match zero spans
    Then the table displays "No spans match the current filter"
    And a "Clear filters" link is visible

  Scenario: Clearing filters from empty state restores all spans
    Given the table displays "No spans match the current filter"
    When the user clicks the "Clear filters" link
    Then all spans are visible again
