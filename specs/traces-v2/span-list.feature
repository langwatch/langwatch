# Span List — Gherkin Spec
# Based on PRD-014: Span List
# Covers: columns, sorting, filtering, aggregates, duplicate spans, cross-view linking, interactions, performance, data gating

# ─────────────────────────────────────────────────────────────────────────────
# COLUMNS AND LAYOUT
# ─────────────────────────────────────────────────────────────────────────────

Feature: Span list columns
  The span list displays every span in a trace as a flat, sortable table.

  Background:
    Given the user is viewing a trace with multiple spans
    And the Span List view is selected

  Scenario: All default columns are visible
    Then the table shows columns Name, Type, Duration, Cost, Tokens, Model, Status, and Start

  Scenario: Name column displays full span name in monospace
    Then each span name is rendered in monospace font
    And span names are not truncated
    And the table scrolls horizontally if names exceed available width

  Scenario: Type column shows colored badges
    Then each span displays its type as a colored badge
    And the badge values include LLM, Tool, Agent, RAG, Guard, Eval, and Span

  Scenario: Duration column formats values by magnitude
    Given a span with duration 1100ms
    And a span with duration 340ms
    And a span with duration 0ms
    Then durations display as "1.1s", "340ms", and "<1ms" respectively

  Scenario: Cost column shows dollar amounts or dash
    Given a span with cost 0.002
    And a span with no cost
    Then costs display as "$0.002" and a dash respectively
    And costs are right-aligned in monospace font

  Scenario: Tokens column shows input and output counts
    Given an LLM span with 520 input tokens and 380 output tokens
    And a Tool span with no token data
    Then tokens display as "520→380" and a dash respectively

  Scenario: Model column shows model name or dash
    Given an LLM span using model "gpt-4o"
    And a Tool span with no model
    Then models display as "gpt-4o" and a dash respectively

  Scenario: Status column shows colored dot
    Given a span with OK status
    And a span with Error status
    Then each status displays as a colored dot

  Scenario: Start column shows offset from trace start
    Given a span starting at the same time as the trace
    And a span starting 340ms after the trace
    And a span starting 1200ms after the trace
    Then start times display as "+0ms", "+340ms", and "+1.2s" respectively

# ─────────────────────────────────────────────────────────────────────────────
# COLUMN VISIBILITY
# ─────────────────────────────────────────────────────────────────────────────

Feature: Span list column visibility
  Redundant columns can be hidden when filtering to a single type.

  Background:
    Given the user is viewing a trace with multiple span types
    And the Span List view is selected

  Scenario: All columns visible by default
    Then all eight columns are visible

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

Feature: Span list sorting
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

  Scenario: Error status sorts first
    When the user sorts by Status
    Then spans with Error status appear before spans with OK status

  Scenario: Zero-millisecond spans sort as zero
    Given a span with 0ms duration
    When spans are sorted by Duration ascending
    Then the 0ms span appears first

# ─────────────────────────────────────────────────────────────────────────────
# TYPE FILTER
# ─────────────────────────────────────────────────────────────────────────────

Feature: Span list type filter
  Users can filter spans by type to focus on specific span categories.

  Background:
    Given the user is viewing a trace with 2 LLM spans, 1 Tool span, 1 Agent span, and 1 Guard span
    And the Span List view is selected

  Scenario: Type filter defaults to All
    Then the Type filter dropdown shows "All"
    And all 5 spans are visible in the table

  Scenario: Type filter dropdown shows counts per type
    When the user opens the Type filter dropdown
    Then each type shows its span count in parentheses
    And LLM shows "(2)" and Tool shows "(1)"

  Scenario: Types with zero spans are greyed out
    When the user opens the Type filter dropdown
    Then types with 0 spans are greyed out but visible

  Scenario: Selecting a single type filters the list
    When the user selects LLM in the Type filter
    Then only LLM spans are visible in the table

  Scenario: Multi-select shows multiple types
    When the user selects both LLM and Tool in the Type filter
    Then LLM and Tool spans are visible
    And Agent and Guard spans are hidden

  Scenario: Selecting All unchecks individual selections
    Given the user has selected LLM and Tool
    When the user selects All
    Then all individual type selections are cleared
    And all spans are visible

# ─────────────────────────────────────────────────────────────────────────────
# NAME SEARCH
# ─────────────────────────────────────────────────────────────────────────────

Feature: Span list name search
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

Feature: Span list combined filters
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

Feature: Span list count display
  The span count always shows how many spans match the current filters.

  Background:
    Given the user is viewing a trace with 5 spans
    And the Span List view is selected

  Scenario: Unfiltered count shows total
    Then the span count reads "5 of 5 spans"

  Scenario: Filtered count shows matching and total
    When the user filters to only LLM spans and 2 match
    Then the span count reads "2 of 5 spans"

# ─────────────────────────────────────────────────────────────────────────────
# FOOTER AGGREGATES
# ─────────────────────────────────────────────────────────────────────────────

Feature: Span list footer aggregates
  A footer row shows totals for the visible spans.

  Background:
    Given the user is viewing a trace with multiple spans
    And the Span List view is selected

  Scenario: Unfiltered footer shows trace-level totals
    Then the footer row label reads "Totals:"
    And the footer duration shows the trace total duration with an asterisk
    And a footnote reads "trace duration"
    And the footer cost shows the sum of all span costs
    And the footer tokens shows the sum of all span tokens

  Scenario: Filtered footer shows filtered totals
    When the user filters to only LLM spans
    Then the footer row label reads "Filtered totals:"
    And the footer cost shows the sum of only LLM span costs
    And the footer tokens shows the sum of only LLM span tokens

# ─────────────────────────────────────────────────────────────────────────────
# DUPLICATE SPAN NAMES
# ─────────────────────────────────────────────────────────────────────────────

Feature: Span list duplicate span names
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
    Then a tooltip shows the span ID
    And the span ID is not shown as a table column

  Scenario: No artificial index numbers
    Then the table does not append index numbers like "#1", "#2", "#3" to span names

# ─────────────────────────────────────────────────────────────────────────────
# CROSS-VIEW LINKING FROM WATERFALL
# ─────────────────────────────────────────────────────────────────────────────

Feature: Span list cross-view linking
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

Feature: Span list row interactions
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

  Scenario: Hovering a row shows span ID tooltip
    When the user hovers over a span row
    Then a tooltip displays the span ID

# ─────────────────────────────────────────────────────────────────────────────
# PERFORMANCE
# ─────────────────────────────────────────────────────────────────────────────

Feature: Span list performance
  The span list handles large traces efficiently with virtualization.

  Scenario: Small traces render all rows
    Given a trace with fewer than 100 spans
    When the Span List view is selected
    Then all rows are rendered in the DOM

  Scenario: Medium traces use row virtualization
    Given a trace with between 100 and 500 spans
    When the Span List view is selected
    Then only visible rows are rendered and off-screen rows are recycled

  Scenario: Large traces show load-more threshold
    Given a trace with more than 500 spans
    When the Span List view is selected
    Then the first 200 spans are shown
    And a message reads "Showing first 200 of N. Load more."

  Scenario: Loading more spans in a large trace
    Given a trace with more than 500 spans
    And the first 200 spans are shown
    When the user clicks "Load more"
    Then additional spans are loaded into the table

# ─────────────────────────────────────────────────────────────────────────────
# DATA GATING AND EDGE CASES
# ─────────────────────────────────────────────────────────────────────────────

Feature: Span list data gating
  The span list handles missing data and edge cases gracefully.

  Background:
    Given the Span List view is selected

  Scenario: Single-span trace shows one row
    Given a trace with exactly one span
    Then the table shows a single row with that span's data

  Scenario: Missing cost tokens and model show dashes
    Given a span with no cost, no tokens, and no model
    Then the Cost, Tokens, and Model cells display a dash
    And those columns are not hidden

  Scenario: All spans filtered out shows empty message
    Given the user has applied filters that match zero spans
    Then the table displays "No spans match the current filter"
    And a link to clear filters is visible

  Scenario: Clearing filters from empty state restores all spans
    Given the table displays "No spans match the current filter"
    When the user clicks the clear filter link
    Then all spans are visible again
