# Accessibility & Responsive Behavior — Gherkin Spec
# Covers: page-level shortcuts, drawer-level shortcuts, ARIA landmarks
#
# The shipped keyboard model is "global page shortcuts" + "global
# drawer shortcuts" listening on `document.keydown`, gated only by
# whether the user is typing in an input. There is no focus-zone
# router. Drawer shortcuts: `[`/`]` for previous/next span, `←`/`→`
# for previous/next trace in conversation, `1`-`5` for viz tabs,
# `T`/`C` for trace vs conversation modes (NOT a single toggle),
# `?` for help, etc. See `useTraceDrawerShortcuts.ts` and
# `traceDrawerShortcutTable.ts` for the canonical list. Anything
# beyond that (focus zones, per-element ARIA, etc.) is `@planned`.

# ─────────────────────────────────────────────────────────────────────────────
# FOCUS ZONE MODEL
# ─────────────────────────────────────────────────────────────────────────────

Feature: Accessibility and responsive behavior

@planned
Rule: Focus zone model
  # Not yet implemented as of 2026-05-01.
  # Page and drawer shortcuts are wired as global `document.keydown`
  # listeners with an `isTextInput`/`isTypingTarget` guard — they don't
  # consult focus zones. There is no concept of "table zone has focus"
  # vs "viz zone has focus" in code.

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

# ─────────────────────────────────────────────────────────────────────────────
# ESCAPE BEHAVIOUR (DRAWER)
# ─────────────────────────────────────────────────────────────────────────────

Rule: Drawer Escape behaviour
  Inside the drawer, Escape unwinds drawer-internal state in this order:
  shortcuts-help dialog → selected span → close drawer. The flame-graph
  zoom level is NOT part of the cascade as of 2026-05-01.

  Background:
    Given the drawer is open

  Scenario: Escape closes the shortcuts-help dialog when it is open
    Given the drawer's "?" shortcuts-help dialog is open
    When the user presses Escape
    Then the shortcuts-help dialog closes
    And the drawer remains open

  Scenario: Escape clears the selected span when no help dialog is open
    Given a span is selected in the drawer
    And the shortcuts-help dialog is not open
    When the user presses Escape
    Then the span selection is cleared
    And the drawer remains open

  Scenario: Escape closes the drawer when no span is selected and no help is open
    Given no span is selected
    And the shortcuts-help dialog is not open
    When the user presses Escape
    Then the drawer closes

  Scenario: Escape clears the bulk selection before any drawer or modal handler runs
    Given the user has at least one trace row selected via the bulk selection
    When the user presses Escape
    Then the bulk selection is cleared
    And the drawer Escape handler does not run for this key event

# ─────────────────────────────────────────────────────────────────────────────
# PAGE-LEVEL KEYBOARD SHORTCUTS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Page-level keyboard shortcuts
  Global shortcuts listed in `PAGE_GROUPS` (PageKeyboardShortcuts.tsx)
  and registered via `useKeyboardShortcuts.ts`. All listeners bail when
  the event target is an input/textarea/contentEditable element.

  Scenario: "[" toggles the filter sidebar
    Given the user is not typing in an input
    When the user presses "["
    Then the filter sidebar's collapsed state toggles in `uiStore`

  Scenario: "?" opens the page-level shortcuts-help dialog
    Given the trace drawer is closed
    When the user presses "?"
    Then `uiStore.shortcutsHelpOpen` toggles
    # When the drawer IS open, the page-level "?" handler bails so the
    # drawer's own "?" handler owns the key.

  Scenario: Cmd/Ctrl+F opens the in-page Find overlay
    Given the Find overlay is closed
    When the user presses Cmd/Ctrl+F
    Then `findStore.open()` is called and the overlay opens
    And the browser's native find is suppressed for that key event

  Scenario: Cmd/Ctrl+F again closes Find and lets the browser handle the next press
    Given the Find overlay is open
    When the user presses Cmd/Ctrl+F
    Then `findStore.close()` is called and the overlay closes
    And `preventDefault` is NOT called, so a follow-up press surfaces native browser find

  Scenario: D toggles density between compact and comfortable
    Given the user is not typing in an input
    When the user presses "d" or "D"
    Then `densityStore` flips between "compact" and "comfortable"

  # @planned — "/" focusing the search bar from anywhere is not wired
  # in `useKeyboardShortcuts.ts` as of 2026-05-01. The SearchBar
  # advertises "/" as its hint but only handles it while already focused.

# ─────────────────────────────────────────────────────────────────────────────
# DRAWER-LEVEL KEYBOARD SHORTCUTS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Drawer-level keyboard shortcuts
  Single `document.keydown` listener registered by `useTraceDrawerShortcuts`
  while the drawer is mounted with a trace. Shortcuts come from the
  central `TRACE_DRAWER_SHORTCUTS` table; the help dialog reads the
  same table so they cannot drift.

  Background:
    Given the drawer is open with a trace

  Scenario: "?" toggles the drawer's keyboard-shortcut help dialog
    When the user presses "?"
    Then `drawerStore.shortcutsOpen` toggles

  Scenario: "[" and "]" navigate between spans in the current trace
    Given the trace has a non-empty span tree
    When the user presses "]"
    Then the next span in the tree is selected
    When the user presses "["
    Then the previous span in the tree is selected

  Scenario: ← and → navigate between turns in a conversation
    Given the trace is part of a conversation with previous and next turns
    When the user presses "→"
    Then the drawer navigates to the next trace in the conversation
    When the user presses "←"
    Then the drawer navigates to the previous trace in the conversation

  Scenario: 1, 2, 3, 4, 5 switch between visualisation tabs
    When the user presses "1" / "2" / "3" / "4" / "5"
    Then the active viz tab becomes Waterfall / Flame / Span list / Topology / Sequence respectively

  Scenario: O returns to the Trace Summary accordion tab
    When the user presses "o" or "O"
    Then `drawerStore.activeTab` is set to "summary"

  Scenario: T switches the drawer to Trace mode
    When the user presses "t" or "T"
    Then `drawerStore.viewMode` is set to "trace"

  Scenario: C switches to Conversation mode when the trace has a conversation
    Given the trace has a `conversationId`
    When the user presses "c" or "C"
    Then `drawerStore.viewMode` is set to "conversation"

  Scenario: C is a no-op when the trace has no conversation
    Given the trace has no `conversationId`
    When the user presses "c" or "C"
    Then nothing happens (the shortcut entry's guard rejects the key)

  Scenario: P opens the Prompts tab when the trace touches a managed prompt
    Given the trace has `containsPrompt = true` or carries `langwatch.prompt_ids`
    When the user presses "p" or "P"
    Then `viewMode` becomes "trace" and `activeTab` becomes "prompts"

  Scenario: L opens the LLM tab
    When the user presses "l" or "L"
    Then `viewMode` becomes "trace" and `activeTab` becomes "llm"

  Scenario: M toggles the maximised drawer state
    When the user presses "m" or "M"
    Then `drawerStore.maximized` toggles

  Scenario: R refreshes the active trace
    When the user presses "r" or "R"
    Then `refreshActiveTrace()` is invoked

  Scenario: Y copies the trace ID to the clipboard
    When the user presses "y" or "Y"
    Then `navigator.clipboard.writeText(trace.traceId)` is called

  Scenario: B navigates back to the previous trace if the back stack is non-empty
    Given the back-history stack has at least one prior trace
    When the user presses "b" or "B"
    Then `goBack()` is invoked

  Scenario: Drawer shortcuts skip OS chords and typing targets
    When the event has `ctrl`, `meta`, or `alt` modifier set, OR the event target is an input/textarea/contentEditable
    Then no drawer shortcut runs for that event

# ─────────────────────────────────────────────────────────────────────────────
# ARIA LANDMARKS
# ─────────────────────────────────────────────────────────────────────────────

Rule: ARIA landmarks
  Top-level page regions are marked with ARIA roles and labels in
  `TracesPage.tsx`.

  Scenario: Outermost VStack has role "application" and label "Trace explorer"
    Given the Observe page is loaded
    Then the outermost wrapper has role "application" and aria-label "Trace explorer"

  Scenario: Search bar wrapper has role "search" and label "Trace search"
    Given the search bar is visible
    Then its wrapper has role "search" and aria-label "Trace search"

  Scenario: Filter sidebar has role "complementary" and label "Trace filters"
    Given the filter sidebar is visible
    Then the aside has role "complementary" and aria-label "Trace filters"

  Scenario: Results pane has role "main" and label "Trace results"
    Given the results pane is visible
    Then the wrapper has role "main" and aria-label "Trace results"

  # @planned — A dedicated `role="complementary"` + aria-label
  # "Trace detail" on the trace drawer is not present in
  # `TraceDrawerShell.tsx` as of 2026-05-01.

# ─────────────────────────────────────────────────────────────────────────────
# ARIA LABELS / LIVE REGIONS
# ─────────────────────────────────────────────────────────────────────────────

Rule: ARIA live region for new-trace count
  The "N new" scroll-up indicator above the table is a live region.

  Scenario: New-traces indicator announces itself politely
    Given the user has scrolled past the threshold and new traces have arrived
    Then `NewTracesScrollUpIndicator` is rendered with role "status" and aria-live "polite"
    And its aria-label reads "{count} new trace(s) above — scroll up"

@planned
Rule: ARIA labels on status dots, span icons, timing bars, accordions, rows
  # Not yet implemented as of 2026-05-01.
  # Per-status dot / per-span-type icon / per-timing-bar aria-labels
  # do not exist in the current trace table or waterfall components.
  # `aria-expanded`/`aria-selected` on accordion sections and
  # selected rows are also not wired.

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

@planned
Rule: ARIA live announcements for filter changes, drawer load, errors
  # Not yet implemented as of 2026-05-01.

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

Rule: Keyboard shortcut hint badges
  Hint badges (`<Kbd>`) are sprinkled on visible surfaces wherever a
  shortcut is bound. Validated cases below; the rest are aspirational.

  Scenario: Integrate drawer tabs show their letter shortcuts
    Given the Integrate drawer is open
    Then each tab trigger renders a `<Kbd>` with "S", "M", "P", or "I"

  Scenario: Empty-state Integrate CTA shows its "I" shortcut
    Given the empty-state journey shows the Integrate CTA
    Then the "Integrate my code" button renders a `<Kbd>` with "I"

  Scenario: Empty-state Skip footer button shows its "K" shortcut
    Given the empty-state journey footer is visible
    Then the "Skip for now" button renders a `<Kbd>` with "K"

  # @planned — Per-viz-tab "1"/"2"/"3"/"4"/"5" Kbd badges, drawer-header
  # "J"/"K" badges, and conversation-context "[" / "]" badges are not
  # present in `SpanTabBar.tsx`, `DrawerHeader.tsx`, or
  # `ConversationContext.tsx` as of 2026-05-01.

# ─────────────────────────────────────────────────────────────────────────────
# COLOR CONTRAST
# ─────────────────────────────────────────────────────────────────────────────

@planned
Rule: Color contrast and non-color differentiation
  # Not yet verified by automated tests as of 2026-05-01.
  # The codebase uses Chakra v3 semantic tokens (`fg`, `bg.surface`,
  # `border`, etc.) which the design system claims meets WCAG AA, but
  # there are no automated contrast assertions or per-spec
  # status-label fallbacks for status-dot colour reliance.

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

@planned
Rule: Touch targets
  # Not yet implemented as of 2026-05-01.
  # The compact / comfortable density toggle exists, but there is no
  # tablet-viewport detection that auto-switches to comfortable, and no
  # 44px minimum-touch-target guarantees for all interactive elements.

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

@planned
Rule: Responsive breakpoints using container queries
  # Not yet implemented as of 2026-05-01.
  # `TracesPage.tsx` uses fixed sidebar widths (220px expanded /
  # 40px collapsed) and a static three-column flex layout. There are
  # no Chakra container queries in the traces-v2 layout, no
  # auto-collapse-on-drawer-open behaviour at medium widths, no
  # column-priority hiding rules, and no full-width mobile drawer.

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

@planned
Rule: Table column priority when width decreases
  # Not yet implemented as of 2026-05-01.
  # Columns are configured per lens via `useTraceLensColumns` and
  # resized manually via `ColumnResizeGrip`; there is no width-driven
  # progressive-hide priority list.

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

@planned
Rule: Drawer behavior at narrow viewports
  # Not yet implemented as of 2026-05-01. The drawer uses an
  # edge-resize grip and a "maximize" toggle (the M shortcut), but no
  # automatic full-screen mode below 1024px.

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
