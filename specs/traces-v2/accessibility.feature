# Accessibility & Responsive Behavior — Gherkin Spec
# Based on PRD-011: Accessibility & Responsive Behavior
# Covers: keyboard navigation, focus zones, escape cascade, focus management, ARIA, shortcut hints, color contrast, touch targets, responsive breakpoints

# ─────────────────────────────────────────────────────────────────────────────
# FOCUS ZONE MODEL
# ─────────────────────────────────────────────────────────────────────────────

Feature: Focus zone model
  Keyboard shortcuts are scoped to focus zones so the same key means different things in different parts of the UI.

  Scenario: Only the focused zone responds to shortcuts
    Given the table zone has focus
    When the user presses Up/Down
    Then the table navigates between trace rows
    And the span tree does not respond to the key press

  Scenario: Clicking inside a zone transfers focus to that zone
    Given the table zone has focus
    When the user clicks inside the span tree visualization
    Then the viz zone receives focus
    And the table zone loses focus

  Scenario: Opening the drawer focuses the drawer
    Given the table zone has focus
    When the user opens a trace drawer
    Then the drawer zone receives focus

  Scenario: Tab cycles between zones within the drawer
    Given the drawer is open
    And the viz zone has focus
    When the user presses Tab
    Then focus moves to the tab bar
    When the user presses Tab again
    Then focus moves to the accordions
    When the user presses Tab again
    Then focus cycles back to the viz zone

  Scenario: Shift+Tab reverses the cycle within the drawer
    Given the drawer is open
    And the viz zone has focus
    When the user presses Shift+Tab
    Then focus moves to the accordions

  Scenario: Global shortcuts work regardless of focus zone
    Given the viz zone has focus inside the drawer
    When the user presses /
    Then the search bar receives focus

# ─────────────────────────────────────────────────────────────────────────────
# ESCAPE CASCADE
# ─────────────────────────────────────────────────────────────────────────────

Feature: Escape cascade
  Escape always exits the current context one level at a time in a strictly ordered cascade.

  Scenario: Escape zooms out the flame graph when zoomed
    Given the drawer is open
    And the flame graph is zoomed into a block
    When the user presses Escape
    Then the flame graph zooms out one level

  Scenario: Escape closes the span tab when open
    Given the drawer is open
    And a span tab is open
    And the flame graph is not zoomed
    When the user presses Escape
    Then the span tab closes
    And the drawer returns to the Trace Summary tab

  Scenario: Escape closes the drawer when no nested state remains
    Given the drawer is open
    And no span tab is open
    And the flame graph is not zoomed
    When the user presses Escape
    Then the drawer closes
    And focus returns to the previously selected table row

  Scenario: Escape unfocuses the search bar
    Given the search bar has focus
    And the drawer is not open
    When the user presses Escape
    Then the search bar loses focus

  Scenario: Escape is a no-op when nothing is active
    Given the drawer is not open
    And the search bar does not have focus
    When the user presses Escape
    Then nothing happens

  Scenario: Repeated Escape unwinds all nested state in order
    Given the drawer is open
    And the flame graph is zoomed into a block
    And a span tab is open
    When the user presses Escape three times
    Then the first press zooms out the flame graph
    And the second press closes the span tab
    And the third press closes the drawer

# ─────────────────────────────────────────────────────────────────────────────
# ZONE: PAGE (GLOBAL)
# ─────────────────────────────────────────────────────────────────────────────

Feature: Page-level keyboard shortcuts
  Global shortcuts that work from any focus zone on the page.

  Scenario: Slash focuses the search bar from anywhere
    Given the table zone has focus
    When the user presses /
    Then the search bar receives focus

  Scenario: Slash focuses the search bar from inside the drawer
    Given the drawer is open
    And the viz zone has focus
    When the user presses /
    Then the search bar receives focus

# ─────────────────────────────────────────────────────────────────────────────
# ZONE: SEARCH BAR
# ─────────────────────────────────────────────────────────────────────────────

Feature: Search bar keyboard shortcuts
  Keyboard shortcuts available when the search bar has focus.

  Background:
    Given the search bar has focus

  Scenario: Enter executes the query
    When the user types a search term and presses Enter
    Then the search query executes

  Scenario: Escape unfocuses the search bar and returns focus to the table
    When the user presses Escape
    Then the search bar loses focus
    And the table zone receives focus

  Scenario: Up and Down navigate autocomplete suggestions
    Given autocomplete suggestions are visible
    When the user presses Down
    Then the next suggestion is highlighted
    When the user presses Up
    Then the previous suggestion is highlighted

  Scenario: Tab accepts the autocomplete suggestion
    Given an autocomplete suggestion is highlighted
    When the user presses Tab
    Then the highlighted suggestion is accepted into the search input

# ─────────────────────────────────────────────────────────────────────────────
# ZONE: FILTER SIDEBAR
# ─────────────────────────────────────────────────────────────────────────────

Feature: Filter sidebar keyboard shortcuts
  Keyboard shortcuts available when the filter sidebar has focus.

  Background:
    Given the filter sidebar has focus

  Scenario: Space toggles the focused checkbox
    Given a filter checkbox is focused
    When the user presses Space
    Then the checkbox toggles its checked state

  Scenario: Tab moves to the next facet section
    Given the user is in a facet section
    When the user presses Tab
    Then focus moves to the next facet section

  Scenario: Shift+Tab moves to the previous facet section
    Given the user is in a facet section
    When the user presses Shift+Tab
    Then focus moves to the previous facet section

# ─────────────────────────────────────────────────────────────────────────────
# ZONE: TABLE
# ─────────────────────────────────────────────────────────────────────────────

Feature: Table keyboard shortcuts
  Keyboard shortcuts available when the trace table has focus.

  Background:
    Given the table zone has focus
    And the trace table has rows

  Scenario: Up and Down navigate between trace rows
    Given a trace row is focused
    When the user presses Down
    Then the next trace row receives focus
    When the user presses Up
    Then the previous trace row receives focus

  Scenario: Enter opens the drawer for the focused row
    Given a trace row is focused
    When the user presses Enter
    Then the drawer opens showing the trace detail for that row

  Scenario: Shift+Enter opens the trace peek for the focused row
    Given a trace row is focused
    When the user presses Shift+Enter
    Then the trace peek opens for that row

# ─────────────────────────────────────────────────────────────────────────────
# ZONE: DRAWER (CHROME)
# ─────────────────────────────────────────────────────────────────────────────

Feature: Drawer chrome keyboard shortcuts
  Shortcuts that work anywhere in the drawer regardless of which sub-zone has focus.

  Background:
    Given the drawer is open

  Scenario: T toggles between Trace and Conversation mode
    Given the trace has a conversation
    When the user presses T
    Then the drawer toggles between Trace and Conversation mode

  Scenario: T does nothing when no conversation exists
    Given the trace has no conversation
    When the user presses T
    Then nothing happens

  Scenario: O switches to Trace Summary tab when a span tab is open
    Given a span tab is open
    When the user presses O
    Then the drawer switches to the Trace Summary tab

  Scenario: Escape follows the cascade from the drawer
    When the user presses Escape
    Then the escape cascade behavior applies

# ─────────────────────────────────────────────────────────────────────────────
# ZONE: VIZ — SPAN TREE (WATERFALL)
# ─────────────────────────────────────────────────────────────────────────────

Feature: Span tree keyboard shortcuts
  Keyboard shortcuts available when the span tree in the waterfall view has focus.

  Background:
    Given the drawer is open
    And the span tree view is active
    And the span tree has focus

  Scenario: Up and Down navigate between visible spans
    Given a span is focused
    When the user presses Down
    Then the next visible span receives focus
    When the user presses Up
    Then the previous visible span receives focus

  Scenario: Left collapses the current span or moves to parent
    Given a span is focused and expanded
    When the user presses Left
    Then the span collapses
    When the user presses Left again
    Then focus moves to the parent span

  Scenario: Right expands the current span or moves to first child
    Given a span is focused and collapsed with children
    When the user presses Right
    Then the span expands
    When the user presses Right again
    Then focus moves to the first child span

  Scenario: Enter selects the span and opens the span tab
    Given a span is focused
    When the user presses Enter
    Then the span is selected
    And the span tab opens showing detail for that span

  Scenario: Home jumps to the first span
    Given a span deep in the tree is focused
    When the user presses Home
    Then the first span in the tree receives focus

  Scenario: End jumps to the last span
    Given a span near the top of the tree is focused
    When the user presses End
    Then the last span in the tree receives focus

# ─────────────────────────────────────────────────────────────────────────────
# ZONE: VIZ — FLAME GRAPH
# ─────────────────────────────────────────────────────────────────────────────

Feature: Flame graph keyboard shortcuts
  Keyboard shortcuts available when the flame graph has focus.

  Background:
    Given the drawer is open
    And the flame graph view is active
    And the flame graph has focus

  Scenario: Enter zooms into the focused block
    Given a block is focused
    When the user presses Enter
    Then the flame graph zooms into that block

  Scenario: Space selects the focused block and opens the span tab without zooming
    Given a block is focused
    When the user presses Space
    Then the block is selected
    And the span tab opens for that block
    And the flame graph does not zoom

  Scenario: Backspace zooms out one level
    Given the flame graph is zoomed into a block
    When the user presses Backspace
    Then the flame graph zooms out one level

  Scenario: Escape zooms out when the flame graph is zoomed
    Given the flame graph is zoomed into a block
    When the user presses Escape
    Then the flame graph zooms out one level

  Scenario: Escape cascades when the flame graph is not zoomed
    Given the flame graph is not zoomed
    When the user presses Escape
    Then the escape cascade continues to the next level

  Scenario: Up moves to the parent block
    Given a child block is focused
    When the user presses Up
    Then the parent block receives focus

  Scenario: Down moves to the first child block
    Given a block with children is focused
    When the user presses Down
    Then the first child block receives focus

  Scenario: Left and Right navigate between sibling blocks
    Given a block with siblings is focused
    When the user presses Right
    Then the next sibling block receives focus
    When the user presses Left
    Then the previous sibling block receives focus

# ─────────────────────────────────────────────────────────────────────────────
# ZONE: VIZ — SPAN LIST
# ─────────────────────────────────────────────────────────────────────────────

Feature: Span list keyboard shortcuts
  Keyboard shortcuts available when the span list table has focus.

  Background:
    Given the drawer is open
    And the span list view is active
    And the span list has focus

  Scenario: Up and Down navigate between span rows
    Given a span row is focused
    When the user presses Down
    Then the next span row receives focus
    When the user presses Up
    Then the previous span row receives focus

  Scenario: Enter selects the span and opens the span tab
    Given a span row is focused
    When the user presses Enter
    Then the span is selected
    And the span tab opens showing detail for that span

# ─────────────────────────────────────────────────────────────────────────────
# ZONE: TAB BAR
# ─────────────────────────────────────────────────────────────────────────────

Feature: Tab bar keyboard shortcuts
  Keyboard shortcuts available when the tab bar has focus.

  Background:
    Given the drawer is open
    And the tab bar has focus

  Scenario: Left and Right switch between tabs
    Given the Trace Summary tab is selected
    And a span tab exists
    When the user presses Right
    Then the span tab is selected
    When the user presses Left
    Then the Trace Summary tab is selected

# ─────────────────────────────────────────────────────────────────────────────
# ZONE: ACCORDIONS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Accordion keyboard shortcuts
  Keyboard shortcuts available when the accordion section has focus.

  Background:
    Given the drawer is open
    And the accordions zone has focus

  Scenario: Up and Down navigate between accordion sections
    Given an accordion section is focused
    When the user presses Down
    Then the next accordion section receives focus
    When the user presses Up
    Then the previous accordion section receives focus

  Scenario: Enter toggles an accordion open or closed
    Given an accordion section is focused and collapsed
    When the user presses Enter
    Then the accordion section expands
    When the user presses Enter again
    Then the accordion section collapses

# ─────────────────────────────────────────────────────────────────────────────
# FOCUS MANAGEMENT
# ─────────────────────────────────────────────────────────────────────────────

Feature: Focus management
  Focus moves predictably when UI elements open, close, or change.

  Scenario: Opening the drawer moves focus to the drawer header
    Given the drawer is closed
    When the user opens the drawer
    Then focus moves to the drawer header
    And "Trace detail panel opened" is announced to assistive technology

  Scenario: Closing the drawer returns focus to the table row
    Given the drawer is open for a trace row
    When the drawer closes
    Then focus returns to the trace row that was selected in the table

  Scenario: Opening a span tab moves focus to the span tab label
    Given the drawer is open
    When a span tab opens
    Then focus moves to the span tab label in the tab bar

  Scenario: Trace/Conversation toggle keeps focus on the toggle
    Given the drawer is open
    And the trace has a conversation
    When the user toggles between Trace and Conversation mode
    Then focus stays on the toggle control

  Scenario: Switching tabs keeps focus on the tab button
    Given the drawer is open
    When the user switches tabs in the tab bar
    Then focus stays on the active tab button

  Scenario: Switching accordions keeps focus on the accordion button
    Given the drawer is open
    When the user toggles an accordion section
    Then focus stays on the accordion button

  Scenario: Clicking inside a visualization moves focus to that viz zone
    Given the drawer is open
    When the user clicks inside the waterfall visualization
    Then the span tree viz zone receives focus

  Scenario: Drawer does not trap focus at wide viewports
    Given the container width is 1400px or wider
    And the drawer is open
    When the user presses Tab repeatedly
    Then focus can move back to the table outside the drawer

  Scenario: Drawer traps focus at narrow viewports
    Given the container width is below 1024px
    And the drawer is open as a full-screen panel
    When the user presses Tab repeatedly
    Then focus remains trapped within the drawer

# ─────────────────────────────────────────────────────────────────────────────
# ARIA LANDMARKS
# ─────────────────────────────────────────────────────────────────────────────

Feature: ARIA landmarks
  Regions of the page are marked with appropriate ARIA roles and labels.

  Scenario: Filter sidebar has the correct ARIA role and label
    Given the filter sidebar is visible
    Then it has role "complementary"
    And aria-label "Trace filters"

  Scenario: Trace table has the correct ARIA role and label
    Given the trace table is visible
    Then it has role "main"
    And aria-label "Trace list"

  Scenario: Drawer has the correct ARIA role and label
    Given the drawer is open
    Then it has role "complementary"
    And aria-label "Trace detail"

  Scenario: Search bar has the correct ARIA role and label
    Given the search bar is visible
    Then it has role "search"
    And aria-label "Filter traces"

# ─────────────────────────────────────────────────────────────────────────────
# ARIA LABELS
# ─────────────────────────────────────────────────────────────────────────────

Feature: ARIA labels on interactive elements
  Individual elements carry descriptive ARIA attributes for assistive technology.

  Scenario: Status dot has an aria-label describing the status
    Given a trace row with an error status is visible
    Then the status dot has aria-label "Status: Error"

  Scenario: Span type icon has an aria-label describing the type
    Given a span with type LLM is visible in the tree
    Then the span type icon has aria-label "Type: LLM"

  Scenario: Timing bar has an aria-label describing duration and percentage
    Given a span with a timing bar is visible
    Then the timing bar has an aria-label like "Duration: 1.2 seconds, 52% of trace"

  Scenario: Accordion section has aria-expanded attribute
    Given an accordion section is visible
    When the accordion is collapsed
    Then it has aria-expanded "false"
    When the accordion is expanded
    Then it has aria-expanded "true"

  Scenario: Selected trace row has aria-selected attribute
    Given the user selects a trace row
    Then the row has aria-selected "true"
    And other rows have aria-selected "false"

  Scenario: Origin facet checkboxes are grouped with a label
    Given the filter sidebar is visible
    Then the origin facet checkboxes have role "group"
    And aria-label "Filter by origin"

  Scenario: Density toggle has an aria-label
    Given the density toggle is visible
    Then it has aria-label "Display density"

# ─────────────────────────────────────────────────────────────────────────────
# ARIA LIVE REGIONS
# ─────────────────────────────────────────────────────────────────────────────

Feature: ARIA live regions
  Dynamic content changes are announced to assistive technology.

  Scenario: Filter change announces the updated trace count
    Given the user applies a filter
    Then a live region with aria-live "polite" announces "Showing N traces"

  Scenario: Drawer content loaded is announced
    Given the drawer is open and loading data
    When the data finishes loading
    Then the completion is announced to assistive technology

  Scenario: Error states use the alert role
    Given an error occurs while loading traces
    Then the error message has role "alert"

# ─────────────────────────────────────────────────────────────────────────────
# KEYBOARD SHORTCUT HINTS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Keyboard shortcut hint badges
  Every interactive element with a keyboard shortcut displays a visible hint badge.

  Scenario: Search bar displays the slash shortcut hint
    Given the search bar is visible
    Then a Kbd badge showing "/" appears at the right edge of the input

  Scenario: Viz tabs display numeric shortcut hints
    Given the drawer is open
    Then the Waterfall tab shows a Kbd badge "1"
    And the Flame tab shows a Kbd badge "2"
    And the Span List tab shows a Kbd badge "3"

  Scenario: Trace/Conversation toggle displays the T shortcut hint
    Given the drawer is open
    And the trace has a conversation
    Then the Trace label shows a Kbd badge "T"

  Scenario: Trace Summary tab displays the O shortcut hint when span tab is open
    Given the drawer is open
    And a span tab is open
    Then the Trace Summary label shows a Kbd badge "O"

  Scenario: Close drawer area displays the Esc shortcut hint
    Given the drawer is open
    Then the close button area shows a Kbd badge "Esc"

  Scenario: Prev/next trace shows J and K shortcut hints in drawer header
    Given the drawer is open
    Then the drawer header area shows Kbd badges "J" and "K"

  Scenario: Prev/next turn shows bracket shortcut hints in context peek
    Given the drawer is open in conversation mode
    Then the context peek area shows Kbd badges "[" and "]"

  Scenario: Shortcut badges are always visible, not hover-only
    Given the drawer is open
    Then all shortcut Kbd badges are visible without hovering

  Scenario: Shortcut badges use muted styling
    Given the drawer is open
    Then shortcut Kbd badges use muted color so they do not compete with primary labels

# ─────────────────────────────────────────────────────────────────────────────
# COLOR CONTRAST
# ─────────────────────────────────────────────────────────────────────────────

Feature: Color contrast and non-color differentiation
  The UI meets WCAG 2.1 AA contrast requirements and does not rely on color alone.

  Scenario: Body text meets WCAG AA contrast ratio
    Given body text is displayed
    Then the text-to-background contrast ratio is at least 4.5:1

  Scenario: Large text meets WCAG AA contrast ratio
    Given large text is displayed
    Then the text-to-background contrast ratio is at least 3:1

  Scenario: Status dots are supplemented with text labels
    Given the drawer header shows a trace status
    Then both a colored status dot and a text label are displayed
    And the text label reads "OK" or "Error" as appropriate

  Scenario: Span type colors are supplemented by icons
    Given the span tree shows spans of different types
    Then each span type is differentiated by both a color and an icon
    And the type is not conveyed by color alone

  Scenario: Interactive elements have visible focus rings
    Given an interactive element receives keyboard focus
    Then a visible focus ring outline appears
    And the default Chakra focus outline is not suppressed

# ─────────────────────────────────────────────────────────────────────────────
# TOUCH TARGETS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Touch targets
  Interactive elements meet minimum touch target sizes for tablet users.

  Scenario: Interactive elements meet the 44px minimum on tablet viewports
    Given the user is on a tablet viewport
    Then all interactive elements have at least a 44px touch target

  Scenario: Comfortable density meets the touch target minimum
    Given the table is in comfortable density mode
    Then trace rows are approximately 44px tall

  Scenario: Compact density is below minimum for touch
    Given the table is in compact density mode
    Then trace rows are approximately 32px tall
    And this mode is intended for desktop-only usage

  Scenario: Tablet users default to comfortable density
    Given the user is on a tablet viewport
    Then the table defaults to comfortable density mode

# ─────────────────────────────────────────────────────────────────────────────
# RESPONSIVE BREAKPOINTS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Responsive breakpoints using container queries
  The layout adapts based on content area width using Chakra container queries.

  Background:
    Given the Observe page is loaded

  Scenario: Full three-column layout at wide container width
    Given the container width is 1400px or wider
    Then the filter sidebar, trace table, and drawer are all visible side by side

  Scenario: Filter sidebar auto-collapses when drawer opens at medium-wide width
    Given the container width is between 1200px and 1399px
    When the drawer opens
    Then the filter sidebar auto-collapses
    And the table and drawer are visible

  Scenario: Toggling filters hides the drawer at medium-wide width
    Given the container width is between 1200px and 1399px
    And the drawer is open
    When the user toggles the filter sidebar to show
    Then the drawer hides
    And the filter sidebar and table are visible

  Scenario: Table shows fewer columns at medium-narrow width
    Given the container width is between 1024px and 1199px
    Then the table shows only Name, Duration, and Status columns
    And the filter sidebar is collapsed by default

  Scenario: Drawer goes full-width below 1024px
    Given the container width is below 1024px
    When the drawer opens
    Then the drawer takes full width
    And the table is hidden

  Scenario: Back button returns to table from full-width drawer
    Given the container width is below 1024px
    And the drawer is open full-width
    Then the drawer header shows a back arrow
    When the user presses the back arrow
    Then the drawer closes
    And the table is visible again

  Scenario: Filter sidebar is a slide-over overlay below 1024px
    Given the container width is below 1024px
    When the user opens the filter sidebar
    Then it appears as a slide-over overlay

# ─────────────────────────────────────────────────────────────────────────────
# COLUMN PRIORITY
# ─────────────────────────────────────────────────────────────────────────────

Feature: Table column priority when width decreases
  Columns hide progressively as the table narrows.

  Background:
    Given the Observe page is loaded

  Scenario: Tokens column hides first as the table narrows
    Given the table has all columns visible
    When the available width decreases
    Then the Tokens column is the first to hide

  Scenario: Columns hide in priority order
    Given the table is progressively narrowing
    Then columns hide in this order: Tokens, Model, Cost, Service, Duration

  Scenario: Name and Status columns are always visible
    Given the table width is at its narrowest
    Then the Name and Status columns remain visible

# ─────────────────────────────────────────────────────────────────────────────
# DRAWER AT NARROW VIEWPORTS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Drawer behavior at narrow viewports
  The drawer adapts its layout when the container is narrow.

  Scenario: Drawer becomes full-screen below 1024px
    Given the container width is below 1024px
    When the user opens the drawer
    Then the drawer renders as a full-screen panel

  Scenario: Full-screen drawer shows a back arrow in the header
    Given the container width is below 1024px
    And the drawer is open
    Then the drawer header displays a back arrow button

  Scenario: Visualization gets more vertical space in full-screen drawer
    Given the container width is below 1024px
    And the drawer is open
    Then the visualization section receives more vertical space than in side-by-side layout
