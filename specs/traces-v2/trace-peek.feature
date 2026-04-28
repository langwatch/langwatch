# Trace Peek — Gherkin Spec
# Based on PRD-012: Trace Peek
# Covers: pull-tab trigger, peek panel display, peek content, dismissal, keyboard interaction, data fetching, loading state, data gating, peek+drawer coexistence, conversation context

# ─────────────────────────────────────────────────────────────────────────────
# PULL-TAB ACTIVATION
# ─────────────────────────────────────────────────────────────────────────────

Feature: Pull-tab trigger
  A two-step intentional trigger prevents accidental peek activation while scanning trace rows.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces in the trace table

  Scenario: Hovering a row shows only the normal highlight
    When the user hovers over a trace row
    Then the row shows a normal hover highlight
    And no pull-tab is visible

  Scenario: Pull-tab appears after sustained hover
    When the user hovers over a trace row for approximately 1 second
    Then a pull-tab slides out from the bottom edge of the row
    And the pull-tab overlaps onto the row below
    And the pull-tab is approximately 60px wide and 16px tall with a down-chevron

  Scenario: Quick scanning between rows does not show pull-tabs
    When the user hovers over a row for less than 1 second
    And moves the cursor to the next row
    Then no pull-tab appears on the first row
    And the next row starts its own hover timer

  Scenario: Moving cursor past the pull-tab to the next row dismisses it
    Given a pull-tab is visible on a trace row
    When the user moves the cursor past the pull-tab to the next row
    Then the pull-tab on the first row fades out
    And the next row starts its own hover timer

  Scenario: Moving cursor into the pull-tab opens the peek
    Given a pull-tab is visible on a trace row
    When the user moves the cursor into the pull-tab
    Then the peek panel unfolds from the tab with a smooth expand animation

  Scenario: Pull-tab appears above the row when near viewport bottom
    When the user hovers over a trace row near the bottom of the viewport for approximately 1 second
    Then the pull-tab appears above the row instead of below
    And the peek unfolds upward when activated


# ─────────────────────────────────────────────────────────────────────────────
# PEEK PANEL DISPLAY
# ─────────────────────────────────────────────────────────────────────────────

Feature: Peek panel display
  The peek panel overlays table rows inline without affecting layout or the drawer.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces in the trace table

  Scenario: Peek panel overlays rows below the hovered trace
    When the user opens the peek on a trace row
    Then the peek panel appears inline in the table below the hovered row
    And the peek overlays the rows below without pushing them down
    And the rows below are hidden behind the peek panel

  Scenario: Peek panel has card-like appearance
    When the peek panel is open
    Then the peek has a subtle drop shadow
    And the peek has a slightly elevated surface background color

  Scenario: Peek panel spans the full table width
    When the peek panel is open
    Then the peek panel width matches the full width of the table column area
    And the peek panel height adjusts automatically based on content

  Scenario: Peek panel sits below the drawer in z-index
    Given the drawer is open showing a trace
    When the user opens the peek on a different trace row
    Then the peek panel sits at a higher z-index than table rows
    And the peek panel sits below the drawer in z-index

  Scenario: Peek expand animation feels natural
    When the user activates the pull-tab
    Then the peek expands with a smooth ease-out animation of approximately 250ms

  Scenario: Peek collapse animation is slightly faster
    Given the peek panel is open
    When the peek is dismissed
    Then the peek collapses with an ease-in animation of approximately 200ms
    And the table rows below become visible again


# ─────────────────────────────────────────────────────────────────────────────
# PEEK CONTENT
# ─────────────────────────────────────────────────────────────────────────────

Feature: Peek content
  The peek shows a compact, read-only trace summary with all sections visible at once.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the peek panel is open for a trace

  Scenario: Header section shows trace identity
    Then the peek header shows the root span name
    And the peek header shows a status dot
    And the peek header shows the service name
    And the peek header shows the environment
    And the peek header shows relative time

  Scenario: Metrics section shows performance data
    Then the peek shows the trace duration
    And the peek shows the trace cost
    And the peek shows token counts split by input and output

  Scenario: Metrics section shows LLM-specific fields for LLM traces
    Given the peeked trace is an LLM trace
    Then the peek shows TTFT
    And the peek shows the model name

  Scenario: Input/output section shows computed text
    Then the peek shows the computed input truncated to approximately 200 characters
    And the peek shows the computed output truncated to approximately 200 characters
    And the I/O text is shown as full text, not single-line snippets

  Scenario: Evals section shows compact badges
    Given the peeked trace has evaluations
    Then the peek shows eval badges with name and score or pass/fail indicator
    And all evaluations are shown without overflow

  Scenario: Events section shows count and notable names
    Given the peeked trace has events
    Then the peek shows the event count
    And the peek shows notable event names
    And exceptions are highlighted with a warning indicator

  Scenario: Span summary shows count and type breakdown
    Then the peek shows the total span count
    And the peek shows a type breakdown like "3 spans: llm x2, tool x1"

  Scenario: Footer shows open action and escape hint
    Then the peek footer shows an "Open in drawer" button
    And the peek footer shows an Esc keyboard badge

  Scenario: Peek content requires no scrolling for typical traces
    Then all peek sections are visible at once without scrolling

  Scenario: Peek content is read-only with no interactive elements
    Then the peek has no accordions
    And the peek has no tabs
    And the peek has no expandable sections


# ─────────────────────────────────────────────────────────────────────────────
# PEEK CONTENT EXCLUSIONS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Peek content exclusions
  The peek intentionally omits detailed data that belongs in the drawer.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the peek panel is open for a trace

  Scenario: Peek does not show visualization
    Then the peek does not show a tree view
    And the peek does not show a waterfall view
    And the peek does not show a flame chart

  Scenario: Peek does not show full attributes
    Then the peek does not show span attributes

  Scenario: Peek does not show span-level detail
    Then the peek shows trace-level information only
    And the peek does not show individual span details

  Scenario: Peek does not show eval reasoning
    Then eval badges show name and score only
    And eval badges do not show reasoning or detail text

  Scenario: Peek does not show conversation context
    Then the peek does not show conversation history or thread view


# ─────────────────────────────────────────────────────────────────────────────
# DISMISSING THE PEEK
# ─────────────────────────────────────────────────────────────────────────────

Feature: Dismissing the peek
  The peek is ephemeral and dismisses naturally when the user stops interacting with it.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the peek panel is open for a trace

  Scenario: Moving cursor out of the peek dismisses it
    When the user moves the cursor out of the peek panel
    Then the peek collapses with a reverse animation

  Scenario: Clicking "Open in drawer" closes peek and opens drawer
    When the user clicks the "Open in drawer" button
    Then the peek closes
    And the drawer opens showing that trace

  Scenario: Clicking the source row opens the trace in the drawer
    When the user clicks the source row above the peek
    Then the peek closes
    And the drawer opens showing that trace

  Scenario: Pressing Escape closes the peek
    When the user presses Escape
    Then the peek collapses

  Scenario: Clicking anywhere else closes the peek
    When the user clicks on an area outside the peek panel and outside the source row
    Then the peek collapses


# ─────────────────────────────────────────────────────────────────────────────
# PEEK DOES NOT FOLLOW BETWEEN ROWS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Peek standalone behavior
  Each peek is a standalone action that does not auto-follow when moving to another row.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the peek panel is open for a trace row

  Scenario: Peek does not auto-follow to the next row
    When the user moves the cursor to a different trace row
    Then the peek on the original row closes
    And no peek opens on the new row automatically

  Scenario: Peeking another row requires repeating the full activation
    When the user dismisses the peek
    And hovers over a different trace row for approximately 1 second
    And the pull-tab appears on the new row
    And the user moves the cursor into the new pull-tab
    Then a new peek opens for the second trace row


# ─────────────────────────────────────────────────────────────────────────────
# PEEK AND DRAWER COEXISTENCE
# ─────────────────────────────────────────────────────────────────────────────

Feature: Peek and drawer coexistence
  The peek and drawer operate independently, allowing side-by-side comparison.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the drawer is open showing trace A

  Scenario: Drawer content is not affected by opening a peek
    When the user opens the peek on trace B
    Then the drawer continues showing trace A
    And the drawer content does not change

  Scenario: Side-by-side comparison when table is wide enough
    When the user opens the peek on trace B
    And the table is wide enough for the peek to be visible next to the drawer
    Then the user can see the peek content for trace B alongside the drawer content for trace A

  Scenario: Opening a peeked trace in the drawer replaces drawer content
    Given the peek is open showing trace B
    When the user clicks "Open in drawer" in the peek
    Then the peek closes
    And the drawer now shows trace B


# ─────────────────────────────────────────────────────────────────────────────
# CONVERSATION CONTEXT IN PEEK
# ─────────────────────────────────────────────────────────────────────────────

Feature: Conversation context in peek
  Traces belonging to a conversation show a subtle indicator without full conversation view.

  Background:
    Given the user is authenticated with "traces:view" permission

  Scenario: Peek shows conversation indicator for conversational traces
    Given the peeked trace belongs to a conversation
    When the peek panel is open
    Then the peek header shows a conversation thread identifier
    And the peek header shows the turn position within the conversation

  Scenario: Peek does not show full conversation view
    Given the peeked trace belongs to a conversation
    When the peek panel is open
    Then the peek does not show a full conversation view
    And the conversation toggle is available only after opening in the drawer

  Scenario: Non-conversational traces show no conversation indicator
    Given the peeked trace does not belong to a conversation
    When the peek panel is open
    Then no conversation indicator is shown in the peek header


# ─────────────────────────────────────────────────────────────────────────────
# KEYBOARD INTERACTION
# ─────────────────────────────────────────────────────────────────────────────

Feature: Keyboard interaction for peek
  Keyboard shortcuts provide accessible peek activation and navigation.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces in the trace table

  Scenario: Shift+Enter opens peek for focused row
    Given a trace row is focused via keyboard navigation
    When the user presses Shift+Enter
    Then the peek panel opens for the focused row

  Scenario: Enter alone opens the drawer, not the peek
    Given a trace row is focused via keyboard navigation
    When the user presses Enter
    Then the drawer opens for the focused row
    And no peek panel appears

  Scenario: Escape closes an open peek
    Given the peek panel is open via keyboard activation
    When the user presses Escape
    Then the peek closes

  Scenario: Enter opens peeked trace in drawer
    Given the peek panel is open
    When the user presses Enter
    Then the peek closes
    And the drawer opens showing the peeked trace

  Scenario: T opens conversational trace in conversation mode
    Given the peek panel is open
    And the peeked trace belongs to a conversation
    When the user presses T
    Then the peek closes
    And the drawer opens showing the trace in Conversation mode

  Scenario: T has no effect for non-conversational traces
    Given the peek panel is open
    And the peeked trace does not belong to a conversation
    When the user presses T
    Then nothing happens
    And the peek remains open


# ─────────────────────────────────────────────────────────────────────────────
# DATA FETCHING
# ─────────────────────────────────────────────────────────────────────────────

Feature: Peek data fetching
  The peek reuses table data when possible and fetches minimally when needed.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces in the trace table

  Scenario: Peek is instant when all data is already in the table
    Given the table query includes all relevant columns for the trace
    When the user opens the peek
    Then the peek renders immediately with no network request

  Scenario: Peek fetches summary when table data is incomplete
    Given the table query does not include eval scores or event names
    When the user opens the peek
    Then a single lightweight trace summary query is made for that specific trace

  Scenario: Peek does not fetch full span data
    When the user opens the peek
    Then no full span data is fetched
    And no full I/O content is fetched
    And no eval reasoning is fetched
    And no conversation context is fetched


# ─────────────────────────────────────────────────────────────────────────────
# LOADING STATE
# ─────────────────────────────────────────────────────────────────────────────

Feature: Peek loading state
  The peek shows a graceful loading state when additional data must be fetched.

  Background:
    Given the user is authenticated with "traces:view" permission

  Scenario: Peek shows header immediately with shimmer for pending data
    Given the table data does not include all peek fields
    When the user opens the peek
    Then the peek panel appears immediately
    And the header is populated from existing table data
    And the body shows a subtle shimmer until the summary data loads

  Scenario: Peek shows no loading state when data is available
    Given the table data includes all peek fields
    When the user opens the peek
    Then the peek appears fully populated with no loading indicator


# ─────────────────────────────────────────────────────────────────────────────
# DATA GATING
# ─────────────────────────────────────────────────────────────────────────────

Feature: Peek data gating
  Sections gracefully adapt to missing or inapplicable data.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the peek panel is open for a trace

  Scenario: Trace with no input or output shows placeholder
    Given the peeked trace has no input or output captured
    Then the I/O section shows "No input/output captured" in muted text

  Scenario: Trace with no evaluations hides the evals section
    Given the peeked trace has no evaluations
    Then the evals section is not shown
    And no "no evals" placeholder is displayed

  Scenario: Trace with no events hides the events section
    Given the peeked trace has no events
    Then the events section is not shown

  Scenario: Non-LLM trace hides LLM-specific metrics
    Given the peeked trace is not an LLM trace
    Then TTFT is not shown
    And token counts are not shown
    And model name is not shown
