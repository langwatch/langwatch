# Search & Filter System — Gherkin Spec
# Covers: search bar, query syntax, autocomplete, filter sidebar, facets, range sliders,
#         two-way sync, time range selector, error states, performance, facet density

# ─────────────────────────────────────────────────────────────────────────────
# TIME RANGE SELECTOR
# ─────────────────────────────────────────────────────────────────────────────

Feature: Search and filter system

Rule: Time range selector
  The time range picker sits in the toolbar strip and controls the date window for queries.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces spanning the last 30 days

  Scenario: Default time range is last 30 days
    When the Observe page loads
    Then the time range selector displays "30d"
    And the trace table shows only traces from the last 30 days

  Scenario: Selecting a preset time range
    When the user opens the time range selector
    Then rolling presets are available for "Last 15 minutes", "Last 1 hour", "Last 4 hours", "Last 24 hours", "Last 7 days", "Last 30 days", and "Last 60 days"
    And period-to-date presets are available for "This week", "This month", and "This quarter"

  Scenario: Applying a preset filters traces to that range
    When the user selects "Last 7 days"
    Then the trace table shows traces from the last 7 days
    And the time range selector label updates to "7d"

  Scenario: Absolute range entered in the picker
    When the user opens the time range selector
    Then the popover shows an "Absolute range" panel with From and To datetime-local fields alongside the preset list
    When the user enters absolute From/To values and clicks Apply
    Then the trace table shows traces within that absolute range

  Scenario: Time range preset is reflected in the URL fragment
    When the user selects "Last 1 hour"
    Then the URL fragment encodes the active lens id and "preset=1h"

  Scenario: Absolute custom range is reflected in URL fragment
    When the user sets an absolute range via the From/To fields
    Then the URL fragment encodes the absolute from/to timestamps

  Scenario: Time range is restored from the URL fragment on page load
    Given the user previously selected "Last 7 days" (encoded into the URL fragment)
    When the user reloads or navigates back to the Observe page
    Then the time range selector displays "7d"


# ─────────────────────────────────────────────────────────────────────────────
# SEARCH BAR LAYOUT AND BEHAVIOR
# ─────────────────────────────────────────────────────────────────────────────

Rule: Search bar layout and behavior
  A single input field spanning the full width below the nav bar for query input.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Search bar renders with placeholder text
    When the Observe page loads
    Then the search bar spans the full width below the nav bar
    And the placeholder text reads "Search filters, free text, or Ask AI…"

  Scenario: Search bar shows the current active query
    Given the search bar contains "@status:error AND @model:gpt-4o"
    Then the search bar displays "@status:error AND @model:gpt-4o" as the active query

  Scenario: Clear all button resets the search bar and filters
    Given the search bar contains "@status:error"
    When the user clicks the "Clear all" button
    Then the search bar is empty
    And all filter sidebar controls are reset to neutral

  Scenario: Pressing Enter applies the query
    When the user types "@status:error" in the search bar
    And presses Enter
    Then the trace table filters to show only error traces

  Scenario: Typing does not trigger live search
    When the user types "@status:err" without pressing Enter
    Then the trace table does not update
    And only autocomplete suggestions update live


# ─────────────────────────────────────────────────────────────────────────────
# SEARCH BAR KEYBOARD SHORTCUTS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Search bar keyboard shortcuts
  Keyboard shortcuts for efficient search interaction.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Slash key focuses the search bar
    Given the search bar is not focused
    When the user presses "/"
    Then the search bar receives focus

  Scenario: Escape clears focus from the search bar
    Given the search bar is focused
    When the user presses Escape
    Then the search bar loses focus
    And focus returns to the trace table

  Scenario: Up and Down arrows navigate autocomplete suggestions
    Given the search bar is focused
    And autocomplete suggestions are visible
    When the user presses the Down arrow
    Then the next autocomplete suggestion is highlighted

  Scenario: Tab accepts the current autocomplete suggestion
    Given the search bar is focused
    And an autocomplete suggestion is highlighted
    When the user presses Tab
    Then the highlighted suggestion is inserted into the search bar


# ─────────────────────────────────────────────────────────────────────────────
# QUERY SYNTAX
# ─────────────────────────────────────────────────────────────────────────────

Rule: Query syntax
  The query language supports field expressions, free text, boolean operators, and grouping.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Exact field match
    When the user searches for "@status:error"
    Then only traces with status "error" are shown

  Scenario: Prefix match with glob
    When the user searches for "@model:gpt*"
    Then traces with models matching "gpt" prefix are shown

  Scenario: Free text search in quotes
    When the user searches for "refund policy"
    Then traces with "refund policy" in their input or output content are shown

  Scenario: Negation with NOT
    When the user searches for "NOT @status:error"
    Then traces with status "error" are excluded from results

  Scenario: CSV shorthand for OR within a field
    When the user searches for "@status:error,warning"
    Then traces with status "error" or "warning" are shown

  Scenario: AND operator combines conditions
    When the user searches for "@status:error AND @model:gpt-4o"
    Then only traces with status "error" AND model "gpt-4o" are shown

  Scenario: OR operator matches either condition
    When the user searches for "@status:error OR @model:gpt-4o"
    Then traces with status "error" OR model "gpt-4o" are shown

  Scenario: One level of grouping with parentheses
    When the user searches for "(@status:error OR @status:warning) AND @model:gpt-4o"
    Then traces matching error or warning status AND gpt-4o model are shown

  Scenario: Nested parentheses are rejected
    When the user searches for "((A OR B) AND C) OR D"
    Then the search bar shows an invalid query error

  Scenario: Range syntax with greater-than
    When the user searches for "@cost:>0.01"
    Then only traces with cost greater than 0.01 are shown

  Scenario: Range syntax with less-than
    When the user searches for "@duration:<500"
    Then only traces with duration less than 500ms are shown

  Scenario: Range syntax with bracketed interval
    When the user searches for "@cost:[0.01 TO 1.00]"
    Then only traces with cost between 0.01 and 1.00 are shown

  # Negation shorthand: liqe accepts "-field:value" in addition to "NOT field:value"
  Scenario: Hyphen prefix is shorthand for NOT
    When the user searches for "-@status:error"
    Then traces with status "error" are excluded from results

  Scenario: Unquoted free text is treated as full-text search
    When the user types "timeout" without quotes or @ prefix
    Then it is treated as a full-text search across trace content


# ─────────────────────────────────────────────────────────────────────────────
# SUPPORTED SEARCH FIELDS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Supported search fields
  The query language supports specific fields for filtering traces.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces with varied attributes

  Scenario: Filter by origin
    When the user searches for "@origin:application"
    Then only traces with origin "application" are shown

  Scenario: Filter by status
    When the user searches for "@status:error"
    Then only traces with error status are shown

  Scenario: Filter by model with partial match
    When the user searches for "@model:claude*"
    Then traces with models matching "claude" prefix are shown

  Scenario: Filter by service
    When the user searches for "@service:finance"
    Then only traces from the "finance" service are shown

  Scenario: Filter by span type
    When the user searches for "@spanType:agent"
    Then only traces containing agent spans are shown

  Scenario: Filter by user ID
    When the user searches for "@user:abc123"
    Then only traces from user "abc123" are shown

  Scenario: Filter by conversation ID
    When the user searches for "@conversation:thread_xyz"
    Then only traces belonging to that conversation thread are shown

  Scenario: Filter by token count
    When the user searches for "@tokens:>1000"
    Then only traces with more than 1000 tokens are shown

  Scenario: Existence check with @has
    When the user searches for "@has:annotation"
    Then only traces that have an annotation attached are shown

  # @has and @none accept the closed enum: error, eval, feedback, annotation,
  # conversation, user, customer, topic, subtopic, label
  Scenario: Negative existence check with @none
    When the user searches for "@none:user"
    Then only traces without a user identifier are shown

  Scenario: Filter by event name
    When the user searches for "@event:user.feedback"
    Then only traces with a "user.feedback" event are shown

  Scenario: Filter by eval name
    When the user searches for "@eval:faithfulness"
    Then only traces with a "faithfulness" evaluation are shown

  Scenario: Filter by trace ID
    When the user searches for "@traceId:a3f8c2d1"
    Then only the trace with that exact ID is shown


# ─────────────────────────────────────────────────────────────────────────────
# AUTOCOMPLETE
# ─────────────────────────────────────────────────────────────────────────────

Rule: Search bar autocomplete
  Autocomplete assists users with field names and known values.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Focusing the empty search bar shows all field names
    When the user focuses the empty search bar
    Then the dropdown opens in field mode listing every known field grouped by Trace / Span / Event / Eval / Metrics / Scenario

  Scenario: Typing a partial field name filters the dropdown
    When the user types "mo" in the search bar
    Then the dropdown shows "model" as a matching field

  Scenario: Typing field: shows known values for that field
    When the user types "model:" in the search bar
    Then the dropdown opens in value mode for "model"
    And it lists known model values from the discover payload (facet topValues)

  # Static enum values come from FIELD_VALUES in metadata.ts
  Scenario: Closed enum fields autocomplete from static values
    When the user types "status:" in the search bar
    Then the dropdown lists "error", "warning", and "ok"


# ─────────────────────────────────────────────────────────────────────────────
# FILTER COLUMN LAYOUT
# ─────────────────────────────────────────────────────────────────────────────

Rule: Filter column layout
  A scrollable sidebar with categorical facets and range sliders.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces with varied attributes

  Scenario: Filter sidebar renders facet groups in fixed order
    When the Observe page loads (and the user has expanded the sidebar)
    Then the filter sidebar shows groups in this order: Trace, Subjects, Span, Evaluators, Metrics, Prompts
    And the Trace group leads with Origin, Status, Error message, Guardrail, Contains AI, Root span type, Trace name, Model, Service, Topic, Subtopic, Label, Event
    And range facets (Duration, Cost, Tokens, Prompt tokens, Completion tokens, TTFT, TTLT, Tokens/sec, Tokens estimated, Span count) live in the Metrics group

  Scenario: Group headers can be reordered via drag-and-drop
    When the user drags a group header to a new position
    Then the FACET_GROUPS order updates in the sidebar
    But sections within a group keep their registry order

  Scenario: Dynamic facets appear only when data exists
    Given traces include user IDs
    Then the User facet section appears in the Subjects group
    Given no traces have label data
    Then the Label facet section is not rendered

  Scenario: Facet sections are collapsible
    When the user clicks a facet section heading
    Then the section collapses, showing only the heading

  Scenario: Auto-expand small sections
    Given a section has at most AUTO_EXPAND_THRESHOLD (5) values
    Then the section is auto-expanded when first rendered


# ─────────────────────────────────────────────────────────────────────────────
# FILTER COLUMN COLLAPSE AND EXPAND
# ─────────────────────────────────────────────────────────────────────────────

Rule: Filter column collapse and expand
  The entire filter sidebar can be collapsed to a narrow strip.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Sidebar starts collapsed by default
    When the Observe page loads for the first time
    Then the sidebar is collapsed (default `sidebarCollapsed=true` in `uiStore`)
    And it renders as a narrow icon rail

  Scenario: Collapsed sidebar shows facet icons grouped by section
    Given the sidebar is collapsed
    Then each facet section is represented by its lucide icon (from FACET_ICONS), not a letter abbreviation
    And clusters are visually separated by SectionGroup

  Scenario: Expanding the collapsed sidebar with the chevron
    Given the sidebar is collapsed
    When the user clicks the "Expand sidebar" chevron icon button
    Then the sidebar expands to its full width

  Scenario: Expanding by clicking a section icon
    Given the sidebar is collapsed
    When the user clicks any facet icon
    Then the sidebar expands to its full width

  Scenario: Keyboard shortcut toggles sidebar collapse
    Given the search bar (and any other text input) is not focused
    When the user presses "["
    Then `useUIStore.toggleSidebar` fires and the sidebar collapse state toggles

  Scenario: Active filter badge in collapsed state
    Given the sidebar is collapsed
    And the user has any include or exclude filter active on Status
    Then the Status icon shows an active-count badge

  Scenario: Collapsed state is persisted in localStorage
    Given the user collapses or expands the sidebar
    When the user navigates away and returns to the Observe page
    Then the sidebar restores from `langwatch:traces-v2:ui` in localStorage


# ─────────────────────────────────────────────────────────────────────────────
# CATEGORICAL FACETS — THREE-STAGE CHECKBOXES
# ─────────────────────────────────────────────────────────────────────────────

Rule: Categorical facet three-stage checkboxes
  Each facet value has a three-state checkbox cycling through neutral, include, and exclude.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces with error, warning, and ok statuses

  Scenario: Checkbox starts in neutral state
    When the Observe page loads
    Then all facet checkboxes are in neutral state (unchecked, muted text)

  Scenario: First click sets include state
    When the user clicks the "Error" row under Status
    Then `filterStore.toggleFacet("status","error")` runs
    And the search bar text gains a "status:error" clause
    And the trace table filters to show only error traces

  Scenario: Second click sets exclude state
    Given the "Error" row is in include state
    When the user clicks it again
    Then the clause becomes "NOT status:error"
    And the trace table filters to show all traces except errors

  Scenario: Third click returns to neutral state
    Given the "Error" row is in exclude state
    When the user clicks it again
    Then the "status:error" clause is removed from the query

  Scenario: Include whitelist mode filters to matching traces only
    When the user includes "Error" and "Warning" under Status
    Then only error and warning traces are shown

  Scenario: Exclude blacklist mode hides matching traces
    When the user excludes "Error" under Status (with no includes)
    Then all traces except errors are shown

  Scenario: Include and exclude combined applies include first then subtracts
    When the user includes "Error" and "Warning" and excludes "OK" under Status
    Then the include filter applies first, then the exclude subtracts from results

  Scenario: Entire row is clickable
    When the user clicks the label text or count area of a facet row
    Then the checkbox state cycles the same as clicking the checkbox directly


# ─────────────────────────────────────────────────────────────────────────────
# FILTER ITEM ROW LAYOUT
# ─────────────────────────────────────────────────────────────────────────────

Rule: Filter item row layout
  Every filter item follows a consistent layout: checkbox, optional color dot, label, count.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Status facet rows show color dots
    Then each Status value (Error, Warning, OK) shows a color dot (red, yellow, green)

  Scenario: Origin facet rows show color dots
    Then each Origin value shows a color dot (blue, purple, orange)

  Scenario: Service and Model facets use mono font
    Then Service and Model facet labels are rendered in mono font

  Scenario: Origin and Status facets use standard font
    Then Origin, Status, and Span Type facet labels are rendered in standard font

  Scenario: Counts are right-aligned in mono font
    Then all facet counts are right-aligned and rendered in mono font with muted color

  Scenario: Long labels are truncated with ellipsis
    Given a facet value with a very long label
    Then the label is displayed on a single line with text-overflow ellipsis


# ─────────────────────────────────────────────────────────────────────────────
# CATEGORICAL FACET SELECTION LOGIC
# ─────────────────────────────────────────────────────────────────────────────

Rule: Categorical facet selection logic
  Selections within a facet are OR; selections across facets are AND.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces with varied statuses and models

  Scenario: Multiple selections within a facet produce OR
    When the user checks "Error" and "Warning" under Status
    Then the query contains "(@status:error OR @status:warning)"
    And traces with either status are shown

  Scenario: Selections across facets produce AND
    When the user checks "Error" under Status and "gpt-4o" under Model
    Then the query contains "@status:error AND @model:gpt-4o"
    And only traces matching both conditions are shown

  Scenario: Combined within and across facet selections
    When the user checks "Error" and "Warning" under Status and "gpt-4o" under Model
    Then the query is "(@status:error OR @status:warning) AND @model:gpt-4o"


# ─────────────────────────────────────────────────────────────────────────────
# RANGE FACETS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Range facets
  Double-handled sliders for Tokens, Cost, and Latency filtering.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces with varied token counts, costs, and latencies

  Scenario: Tokens slider adjusts token range filter
    When the user adjusts the Tokens slider to 500..5000
    Then the query contains "tokens:[500 TO 5000]"
    And only traces within that token range are shown

  Scenario: Cost slider adjusts cost range filter
    When the user adjusts the Cost slider to 0.01..1.00
    Then the query contains "cost:[0.01 TO 1.00]"
    And only traces within that cost range are shown

  Scenario: Latency slider adjusts duration range filter
    When the user adjusts the Duration slider to 1000..10000
    Then the query contains "duration:[1000 TO 10000]"
    And only traces within that duration range are shown

  Scenario: Slider min and max are derived from actual data
    Given the maximum observed cost is $2.50
    Then the Cost slider range is $0 to $2.50

  Scenario: Range facet is hidden when no data exists
    Given no traces have cost data
    Then the Cost slider is not rendered

  Scenario: Search bar updates live during slider drag
    When the user drags the Cost slider handle
    Then the search bar text updates live to reflect the current range value
    But no query is executed until the user releases the handle

  Scenario: Query fires 300ms after slider release
    When the user releases the Cost slider handle
    Then the query executes after a 300ms debounce

  Scenario: Re-grabbing slider within debounce window cancels pending query
    When the user releases the Cost slider handle
    And grabs the slider again within 300ms
    Then the pending query is cancelled


# ─────────────────────────────────────────────────────────────────────────────
# ORIGIN-SPECIFIC FACETS
# ─────────────────────────────────────────────────────────────────────────────

# Not yet implemented as of 2026-05-01 — no origin-aware facet expansion logic
# in FilterSidebar; scenario/eval facets are always visible from the registry.
@planned
Rule: Origin-specific facets
  Additional facets appear when a specific origin is selected.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces from application, simulation, and evaluation origins

  Scenario: Simulation origin adds scenario and verdict facets
    When the user selects "Simulation" under Origin
    Then a "Scenario" facet appears with scenario names
    And a "Verdict" facet appears with Pass and Fail options

  Scenario: Evaluation origin adds eval type and score range facets
    When the user selects "Evaluation" under Origin
    Then an "Eval Type" facet appears with evaluation type names
    And a "Score Range" slider appears

  Scenario: Application origin shows only standard facets
    When the user selects "Application" under Origin
    Then no additional origin-specific facets appear


# ─────────────────────────────────────────────────────────────────────────────
# LENS-LOCKED FILTERS
# ─────────────────────────────────────────────────────────────────────────────

# Not yet implemented as of 2026-05-01 — lenses store filterText only, no
# lock semantics; the sidebar always renders fully editable controls.
@planned
Rule: Lens-locked filters
  Presets can lock facet values, preventing user modification.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user is viewing the Errors lens

  Scenario: Locked facet section is collapsed and non-expandable
    Then the Status facet section is collapsed
    And the heading shows a lock icon with "Status: error (set by Errors)"
    And clicking the heading does not expand the section

  Scenario: Locked checkbox disables negation
    Then the Error checkbox is locked to include-only
    And clicking the checkbox does not cycle to exclude or neutral

  Scenario: Locked facet tooltip explains the lock
    When the user hovers over the locked Status heading
    Then a tooltip reads "This filter is set by the Errors view. Switch to All Traces to change it."


# ─────────────────────────────────────────────────────────────────────────────
# TWO-WAY SYNC — CHECKBOX TO SEARCH BAR
# ─────────────────────────────────────────────────────────────────────────────

Rule: Two-way sync from sidebar to search bar
  Checking a checkbox updates the AST and serializes to the search bar.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Checking a checkbox adds a clause to the search bar
    When the user checks "Error" under Status
    Then the search bar shows "@status:error"

  Scenario: Checking multiple values in one facet produces OR
    When the user checks "Error" and "Warning" under Status
    Then the search bar shows "(@status:error OR @status:warning)"

  Scenario: Unchecking the last checkbox removes the clause
    Given the user has "Error" checked under Status
    When the user unchecks "Error"
    Then the "@status:error" clause is removed from the search bar

  Scenario: Moving a slider updates the search bar
    When the user adjusts the Cost slider to 0.01..1.00
    Then the search bar shows "cost:[0.01 TO 1.00]"

  Scenario: Sidebar changes preserve existing free text clauses
    Given the search bar contains "\"refund\""
    When the user checks "Error" under Status
    Then the search bar shows "\"refund\" AND @status:error"


# ─────────────────────────────────────────────────────────────────────────────
# TWO-WAY SYNC — SEARCH BAR TO SIDEBAR
# ─────────────────────────────────────────────────────────────────────────────

Rule: Two-way sync from search bar to sidebar
  Typing a query updates the AST and projects onto sidebar controls.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Typing a field clause checks the corresponding checkbox
    When the user types "@status:error" and presses Enter
    Then the Error checkbox under Status is set to include state

  Scenario: Typing a CSV clause checks multiple checkboxes
    When the user types "@status:error,warning" and presses Enter
    Then the Error and Warning checkboxes under Status are set to include state

  Scenario: Typing a NOT clause sets exclude state on the checkbox
    When the user types "NOT @status:error" and presses Enter
    Then the Error checkbox under Status is set to exclude state (red indeterminate)

  Scenario: Typing a range clause positions the slider
    When the user types "cost:[0.01 TO 1.00]" and presses Enter
    Then the Cost slider is positioned at 0.01 to 1.00

  Scenario: Deleting a clause from the search bar unchecks the corresponding checkbox
    Given the search bar contains "@status:error AND @model:gpt-4o"
    When the user removes "@model:gpt-4o" and presses Enter
    Then the gpt-4o checkbox under Model returns to neutral state

  Scenario: Fields with no sidebar equivalent are silently skipped
    When the user types "@user:abc123 AND @status:error" and presses Enter
    Then the Error checkbox is set to include state
    And the sidebar shows no control for the @user clause


# ─────────────────────────────────────────────────────────────────────────────
# TWO-WAY SYNC — ROUND-TRIP FIDELITY
# ─────────────────────────────────────────────────────────────────────────────

Rule: Two-way sync round-trip fidelity
  The parse-AST-serialize cycle produces the same query string.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Simple query round-trips exactly
    When the user types "@status:error AND @model:gpt-4o" and presses Enter
    Then the search bar text reads "@status:error AND @model:gpt-4o"

  Scenario: Whitespace is normalized in round-trip
    When the user types "@status:error   AND   @model:gpt-4o" and presses Enter
    Then the search bar text reads "@status:error AND @model:gpt-4o"

  Scenario: Field order is preserved
    When the user types "@model:gpt-4o AND @status:error" and presses Enter
    Then the search bar text reads "@model:gpt-4o AND @status:error"

  Scenario: CSV values are sorted alphabetically
    When the user types "@status:warning,error" and presses Enter
    Then the search bar text reads "@status:error,warning"


# ─────────────────────────────────────────────────────────────────────────────
# TWO-WAY SYNC — EDGE CASES
# ─────────────────────────────────────────────────────────────────────────────

Rule: Two-way sync edge cases
  Handling of invalid queries, cross-facet OR, and rapid interactions.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Invalid query syntax does not update the sidebar
    Given the sidebar shows no active filters
    When the user types "@status:" (incomplete query)
    Then the search bar shows a red outline and an error message
    And the sidebar retains its current state from the last valid query

  Scenario: Fixing an invalid query syncs the sidebar
    Given the search bar has an invalid query with a red outline
    When the user fixes the syntax and presses Enter
    Then the sidebar syncs to the new valid state

  Scenario: Cross-facet OR shows a warning badge
    When the user types "@status:error OR @model:gpt-4o" and presses Enter
    Then a warning badge appears on the search bar
    And the badge reads "Query uses cross-facet OR — sidebar may not fully reflect the query."

  Scenario: Parenthesized OR within one facet maps to multi-select
    When the user types "@status:error AND (@model:gpt-4o OR @model:claude*)" and presses Enter
    Then gpt-4o and claude* are both checked under Model

  Scenario: Free text has no sidebar representation
    When the user types "\"refund\"" and presses Enter
    Then the search bar shows "\"refund\""
    And no sidebar checkbox or control reflects the free text

  Scenario: Sidebar interactions preserve non-sidebar clauses
    Given the search bar contains "@user:abc123 AND \"refund\""
    When the user checks "Error" under Status
    Then the search bar shows "@user:abc123 AND \"refund\" AND @status:error"

  Scenario: Rapid checkbox clicks debounce query execution
    When the user clicks three checkboxes in quick succession
    Then each checkbox state updates immediately in the UI
    And only one query fires after the last click

  Scenario: Optimistic UI reverts on query failure
    Given the user clicks a checkbox
    And the query execution fails
    Then the checkbox reverts to its pre-click state with a brief shake animation


# ─────────────────────────────────────────────────────────────────────────────
# FACET COUNT UPDATES
# ─────────────────────────────────────────────────────────────────────────────

Rule: Facet count updates
  Facet counts reflect the currently filtered dataset.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Facet counts update when a filter is applied
    When the user checks "Error" under Status
    Then the count badges on all other facets update to reflect the filtered dataset

  Scenario: Facet counts show how many results another filter would yield
    Given the user has "Error" checked under Status
    Then the Model facet counts show how many error traces each model has

  Scenario: Facet counts are fetched in a single batched query
    When the user applies a filter
    Then all facet counts are fetched in one query, not one per facet


# ─────────────────────────────────────────────────────────────────────────────
# FACET COUNT DISPLAY AND APPROXIMATION
# ─────────────────────────────────────────────────────────────────────────────

# Not yet implemented as of 2026-05-01 — sidebar shows raw integer counts;
# no approximate-count "~" formatting, no >10K threshold, no tooltip.
@planned
Rule: Facet count display and approximation
  Counts are exact for small result sets and approximate for large ones.

  Background:
    Given the user is authenticated with "traces:view" permission

  Scenario: Exact counts below 10,000 traces
    Given the filtered result set has fewer than 10,000 traces
    Then facet counts display the exact number (e.g., "45", "1,230")

  Scenario: Approximate counts above 10,000 traces
    Given the filtered result set exceeds 10,000 traces
    Then facet counts display with a "~" prefix (e.g., "~12.3K")

  Scenario: Count formatting with K suffix
    Given a facet value has 1,200 matching traces
    Then the count displays as "1.2K"

  Scenario: Count formatting with M suffix
    Given a facet value has 1,200,000 matching traces
    Then the count displays as "1.2M"


# ─────────────────────────────────────────────────────────────────────────────
# ZERO-COUNT VALUES AFTER FILTERING
# ─────────────────────────────────────────────────────────────────────────────

Rule: Zero-count values after filtering
  Facet values with zero matches are hidden unless actively selected.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Zero-count values are hidden
    Given the user filters by "@model:gpt-4o"
    And no traces match status "Warning" with model "gpt-4o"
    Then the "Warning" option disappears from the Status facet

  Scenario: Actively checked zero-count values remain visible
    Given the user has "Warning" checked under Status
    When the user applies another filter that reduces Warning count to zero
    Then "Warning" stays visible with count "0" and remains checked

  Scenario: Hidden values reappear when filters are cleared
    Given some Status values are hidden due to active filters
    When the user clears all filters
    Then all Status values reappear with updated counts


# ─────────────────────────────────────────────────────────────────────────────
# HIGH-CARDINALITY FACETS (10+ VALUES)
# ─────────────────────────────────────────────────────────────────────────────

Rule: High-cardinality facets
  Facets with 10 or more values show top 10 with expand and search capabilities.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has 18 distinct model values

  Scenario: Top 10 values shown by default sorted by count descending
    Then the Model facet shows the top 10 values sorted by count descending

  Scenario: Show more expander reveals remaining values
    Then a "Show 8 more" expander appears below the top 10 values
    When the user clicks "Show 8 more"
    Then the remaining 8 values are revealed sorted by count descending
    And the expander text changes to "Show less"

  Scenario: Collapse after expanding
    Given the user expanded the Model facet
    When the user clicks "Show less"
    Then only the top 10 values are visible again

  Scenario: Search input appears for facets with 5+ values
    Given a facet has at least SEARCHABLE_VALUE_THRESHOLD (5) values
    Then an inline filter input appears in the section

  Scenario: Typing in facet search filters the value list
    When the user types "gpt" in the Model facet search
    Then only model values containing "gpt" are displayed

  Scenario: Expanded state persists for the session
    Given the user expanded the Model facet
    When the user scrolls away and back
    Then the Model facet remains expanded

  Scenario: Expanded state resets on page reload
    Given the user expanded the Model facet
    When the user reloads the page
    Then the Model facet shows only the top 10 values


# ─────────────────────────────────────────────────────────────────────────────
# VERY HIGH-CARDINALITY FACETS (50+ VALUES)
# ─────────────────────────────────────────────────────────────────────────────

Rule: Very high-cardinality facets
  Facets with 50 or more values cap visible items and rely on search.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has 60 distinct service values

  Scenario: Show more expander is capped at 30 total
    Then the Service facet shows the top 10 values
    And a "Show 20 more" expander appears
    When the user clicks "Show 20 more"
    Then 30 total values are visible
    And a message reads "And 30 more — use search to filter"

  Scenario: Facet search matches against all values
    When the user types "finance" in the Service facet search
    Then values matching "finance" from all 60 services are shown inline
    And the top-10 list is temporarily replaced with search results

  Scenario: Clearing facet search returns to top-10 view
    Given the user is searching in the Service facet
    When the user clears the search input
    Then the top 10 values are displayed again

  Scenario: SpanName is a sidebar facet under Span
    Then a "Span Name" facet section appears in the Span group
    And it surfaces the most-frequent span names with counts


# ─────────────────────────────────────────────────────────────────────────────
# DATA GATING
# ─────────────────────────────────────────────────────────────────────────────

Rule: Data gating
  Facet values are populated from actual data, not hardcoded.

  Background:
    Given the user is authenticated with "traces:view" permission

  Scenario: Facet values come from actual data
    Given the project has traces from services "finance" and "support"
    Then the Service facet shows "finance" and "support"
    And no other service values appear

  Scenario: Single-value facets are still shown
    Given all traces come from the service "finance"
    Then the Service facet shows "finance" as the only value

  Scenario: Range slider bounds match actual data
    Given the maximum observed latency is 45 seconds
    Then the Latency slider range is 0s to 45s


# ─────────────────────────────────────────────────────────────────────────────
# ERROR STATES
# ─────────────────────────────────────────────────────────────────────────────

Rule: Error states
  Graceful handling of query errors, timeouts, and data failures.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Malformed query syntax shows inline error
    When the user types a query with unmatched quotes
    Then the search bar shows a red outline
    And an inline message below reads "Invalid query syntax — check for unmatched quotes or parentheses."
    And no query is executed

  Scenario: ClickHouse query timeout shows retry option
    Given a query takes too long to execute
    Then the trace table shows "Query timed out. Try narrowing your filters or reducing the time range."
    And a "Retry" button is available

  Scenario: Facet count load failure shows stale counts
    Given facet counts fail to load
    Then the previously loaded counts remain visible
    And a subtle "outdated" badge appears on the affected facet section header
    And hovering the badge shows a tooltip: "Counts may be outdated. Click to refresh."

  Scenario: Clicking outdated badge retries facet count load
    Given the "outdated" badge is showing on a facet section
    When the user clicks the badge
    Then the facet counts are re-fetched


# ─────────────────────────────────────────────────────────────────────────────
# PERFORMANCE
# ─────────────────────────────────────────────────────────────────────────────

Rule: Performance
  Debouncing, batching, and approximation keep the UI responsive.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Checkbox clicks are debounced before query execution
    When the user clicks a checkbox
    Then the query executes after a 300ms debounce period

  Scenario: Multiple rapid clicks produce a single query
    When the user clicks three checkboxes within 300ms
    Then only one query is fired after the final click

  Scenario: Search bar waits for Enter to execute
    When the user types in the search bar without pressing Enter
    Then no query is executed
    And only autocomplete suggestions update

  Scenario: Slider drag does not fire queries
    When the user drags a slider handle
    Then no query is executed until the handle is released


# ─────────────────────────────────────────────────────────────────────────────
# AI QUERY COMPOSER
# ─────────────────────────────────────────────────────────────────────────────

Rule: AI query composer (Ask AI)
  Natural-language → query translation runs in a separate FloatingAiBar mode,
  not inline in the structured search bar.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Free-text in the structured bar stays free-text
    When the user types "show me all errors" in the structured search bar
    Then it is treated as a free-text search clause; no NLP parsing runs

  Scenario: Ask AI button enters AI mode
    When the user clicks "Ask AI" (or presses ⌘I / Ctrl+I)
    Then the structured bar is replaced by a FloatingAiBar
    And submitting a prompt calls `tracesV2.aiAction` (or `tracesV2.aiQuery`)

  Scenario: Ask AI is gated on a configured model provider
    Given the project has no enabled model provider
    When the user clicks the Ask AI button
    Then a primer popover points the user at /settings/model-providers
    And AI mode is not entered


# ─────────────────────────────────────────────────────────────────────────────
# SEARCH BAR INPUT — KEYBOARD & SUGGESTION MODEL
# ─────────────────────────────────────────────────────────────────────────────
# Defines the precise keyboard behaviour around the autocomplete dropdown.
# Core rule: the dropdown is open if and only if the cursor sits inside an
# active token of shape @partial, @field:, or @field:partial — meaning no
# whitespace between the @ and the cursor. Whitespace closes it.
# Enter is contextual: dropdown open → accept, dropdown closed → submit.
# Blur always submits.

Rule: Dropdown open and close based on cursor position
  The autocomplete dropdown is bound to cursor context, not focus alone.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Empty focused editor opens the field-name dropdown
    When the user focuses the empty search bar
    Then the dropdown opens in field-name mode listing every known field

  Scenario: Typing @ keeps the field-name dropdown open
    Given the search bar is empty and focused
    When the user types "@"
    Then the dropdown stays open in field-name mode
    And the @ sigil is stripped at parse time (it is purely an input affordance)

  Scenario: Typing a partial field name filters the dropdown
    Given the search bar is empty and focused
    When the user types "@mo"
    Then the dropdown shows "model" as a matching field

  Scenario: Typing @field: opens the value dropdown
    Given the search bar is empty and focused
    When the user types "@status:"
    Then the dropdown opens in value mode for field "status"
    And the dropdown lists known values for "status"

  Scenario: Typing whitespace inside a token closes the dropdown
    Given the search bar contains "status" and the dropdown is open
    When the user types " " (space)
    Then the dropdown closes (whitespace ends the active token)

  Scenario: Cursor moving out of an @-token closes the dropdown
    Given the search bar contains "@status:error AND foo" with cursor inside "@status:error"
    When the user moves the cursor with the arrow keys to a position outside the @-token
    Then the dropdown closes

  Scenario: Cursor moving back into an @-token reopens the dropdown
    Given the search bar contains "@status:error" and the cursor is after the trailing space
    When the user moves the cursor back into the value "error"
    Then the dropdown reopens in value mode for field "status"

  Scenario: Free text input never opens the dropdown
    Given the search bar is empty and focused
    When the user types "model is broken"
    Then the dropdown stays closed throughout


Rule: Enter is contextual based on dropdown state
  Enter accepts when the dropdown is open; Enter submits when it is closed.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Enter accepts the highlighted suggestion when dropdown is open
    Given the search bar contains "@stat" and the dropdown highlights "status"
    When the user presses Enter
    Then the input becomes "@status:"
    And the dropdown reopens in value mode for field "status"
    And the query is NOT submitted

  Scenario: Enter accepts a value suggestion and inserts a trailing space
    Given the search bar contains "@status:" and the dropdown highlights "error"
    When the user presses Enter
    Then the input becomes "@status:error " with a trailing space
    And the dropdown closes
    And the query is NOT submitted

  Scenario: Enter submits when the dropdown is closed
    Given the search bar contains "@status:error " (trailing space) and the dropdown is closed
    When the user presses Enter
    Then the query "@status:error" is submitted

  Scenario: Two consecutive Enters from a value-mode dropdown picks first value and submits
    Given the search bar contains "@status:" and the dropdown is open
    When the user presses Enter
    And the user presses Enter again
    Then the query "@status:error" is submitted

  Scenario: Three consecutive Enters from @ picks first field, first value, and submits
    Given the search bar contains "@" and the dropdown is open
    When the user presses Enter, Enter, and Enter in sequence
    Then a query of the form "@<first-field>:<first-value>" is submitted

  Scenario: Enter on free text submits
    Given the search bar contains "refund" and the dropdown is closed
    When the user presses Enter
    Then the query "refund" is submitted

  Scenario: Enter on empty input clears the AST
    Given the search bar is empty and focused
    When the user presses Enter
    Then the AST is cleared


Rule: Tab and click mirror Enter for suggestion accept
  Tab and click are alternative ways to accept a highlighted suggestion.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Tab accepts the highlighted suggestion the same way Enter does
    Given the search bar contains "@stat" and the dropdown highlights "status"
    When the user presses Tab
    Then the input becomes "@status:"
    And the dropdown reopens in value mode for field "status"

  Scenario: Tab on a value suggestion inserts trailing space and closes dropdown
    Given the search bar contains "@status:" and the dropdown highlights "error"
    When the user presses Tab
    Then the input becomes "@status:error " with a trailing space
    And the dropdown closes

  Scenario: Clicking a suggestion accepts it the same way Enter does
    Given the search bar contains "@stat" and the dropdown shows "status"
    When the user clicks the "status" suggestion
    Then the input becomes "@status:"
    And the dropdown reopens in value mode for field "status"

  Scenario: Tab when dropdown is closed is a no-op inside the editor
    Given the search bar contains "status:error" and the dropdown is closed
    When the user presses Tab
    Then handleKey returns noop and the browser's native focus traversal runs
    And any resulting blur submits via the blur path


Rule: Escape is hierarchical
  Escape closes the dropdown first; only when the dropdown is already closed does Escape blur the editor.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Escape closes the dropdown without losing focus or text
    Given the search bar contains "@status:err" and the dropdown is open
    When the user presses Escape
    Then the dropdown closes
    And the editor is still focused
    And the text remains "@status:err"

  Scenario: Escape with dropdown closed blurs the editor and submits
    Given the search bar contains "@status:error" and the dropdown is closed
    When the user presses Escape
    Then the editor blurs
    And the query "@status:error" is submitted

  Scenario: Escape then Enter submits the literal typed text
    Given the search bar contains "@status:err" and the dropdown is open
    When the user presses Escape
    And the user presses Enter
    Then the query "@status:err" is submitted as typed


Rule: Blur always submits
  Any cause of blur — clicking out, tabbing out, programmatic focus change — submits the current text.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Clicking outside the search bar submits the query
    Given the search bar contains "@status:error" and is focused
    When the user clicks outside the search bar
    Then the query "@status:error" is submitted

  Scenario: Tabbing out of the search bar submits the query
    Given the search bar contains "@status:error" and is focused
    When the user presses Tab with the dropdown closed
    Then the query "@status:error" is submitted

  Scenario: Sidebar checkbox click after typing submits the typed text first
    Given the search bar contains "@status:error" (unsubmitted) and is focused
    When the user clicks a sidebar checkbox for "@model:gpt-4o"
    Then the search bar text is committed first
    And the resulting query contains both "@status:error" and "@model:gpt-4o"

  Scenario: Blur with invalid syntax shows parse error but preserves text
    Given the search bar contains "@status:" with no value
    When the user clicks outside the search bar
    Then the editor blurs
    And the search bar shows a red outline with the parse error message
    And the text "@status:" is preserved for the user to fix

  Scenario: Submit is idempotent across Enter and blur
    Given the search bar contains "@status:error" and is focused
    When the user presses Enter
    And then clicks outside the search bar
    Then "applyQueryText" is invoked at most once with the same text


Rule: Suggestion accept replaces only the active token
  Accepting a suggestion never disturbs surrounding clauses.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Accepting a value preserves preceding clauses
    Given the search bar contains "@model:gpt-4o AND @stat" with the dropdown open on "status"
    When the user presses Enter
    Then the input becomes "@model:gpt-4o AND @status:"
    And the dropdown reopens in value mode for field "status"

  Scenario: Accepting a value preserves following clauses
    Given the search bar contains "@stat AND @model:gpt-4o" with the cursor in "@stat" and the dropdown open on "status"
    When the user presses Enter
    Then the input becomes "@status: AND @model:gpt-4o"
    And the dropdown reopens in value mode for field "status"


Rule: Page-level focus shortcut
  The slash key focuses the search bar from anywhere on the page.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Slash from outside any input focuses the editor
    Given no input or contenteditable is focused
    When the user presses "/"
    Then the search bar receives focus
    And no "/" character is inserted into the editor

  Scenario: Slash inside another input does nothing special
    Given a different input field is focused
    When the user presses "/"
    Then a "/" is typed into that input as normal
    And the search bar does not steal focus


# ─────────────────────────────────────────────────────────────────────────────
# SUBJECTS GROUP — IDENTITY-AXIS FACETS
# ─────────────────────────────────────────────────────────────────────────────
# The Subjects group answers "who or what is this trace about?" — the user,
# conversation thread, paying customer, and (when produced by a simulator)
# the scenario run that emitted the trace. Splits these out of the Trace
# block so the sidebar reads as two distinct axes: trace-shape vs identity.

Rule: Subjects sidebar group
  Identity-axis facets sit in their own Subjects group between Trace and Span.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces with user, conversation, customer, and scenario data

  Scenario: Subjects group renders between Trace and Span
    When the Observe page loads
    Then a "Subjects" group is visible in the filter sidebar
    And it sits between the Trace group and the Span group

  Scenario: Subjects group lists user, conversation, customer, scenarioRun in that order
    When the Observe page loads
    Then the Subjects group contains the User, Conversation, Customer, and Scenario run sections in that order

  Scenario: User and Conversation no longer appear in the Trace group
    When the Observe page loads
    Then no "User" or "Conversation" sections appear under the Trace group
    And those sections appear under the Subjects group instead

  Scenario: Customer facet filters by langwatch.customer_id
    When the user selects a customer value under Subjects
    Then the search bar shows "@customer:<id>"
    And the trace table filters to traces matching that customer ID

  Scenario: ScenarioRun facet filters simulator-produced traces
    Given the project has traces from scenario runs
    When the user selects a scenario run value under Subjects
    Then the search bar shows "@scenarioRun:<id>"
    And the trace table filters to traces emitted by that scenario run

  Scenario: has and none toggles work for customer
    When the user types "@has:customer" and presses Enter
    Then only traces with a non-empty langwatch.customer_id are shown
    When the user types "@none:customer" and presses Enter
    Then only traces without a langwatch.customer_id are shown


# ─────────────────────────────────────────────────────────────────────────────
# DYNAMIC ATTRIBUTE PREFIXES — TRACE / SPAN / EVENT
# ─────────────────────────────────────────────────────────────────────────────
# Three dynamic-prefix namespaces let users filter on any attribute key
# present in the data without registering it up front:
#   trace.attribute.<key>:<value>   — direct match on trace_summaries.Attributes
#   span.attribute.<key>:<value>    — any-span match on stored_spans.SpanAttributes
#   event.attribute.<key>:<value>   — any-event match on stored_spans.Events.Attributes
# A legacy `attribute.<key>` form aliases trace.attribute.<key>; new UIs
# should suggest the namespaced form.

Rule: Dynamic attribute prefix discovery
  Typing one of the dynamic prefixes opens a key-discovery dropdown listing
  attribute keys actually present in the time window.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces with trace, span, and event attributes

  Scenario: Field-mode dropdown surfaces dynamic prefixes as first-class entries
    When the user opens the search bar dropdown in field mode
    Then "trace.attribute.<key>", "span.attribute.<key>", and "event.attribute.<key>" appear as suggestion rows
    And each row is grouped under its respective Trace / Span / Event header

  Scenario: Typing trace.attribute. opens a key-discovery dropdown
    When the user types "trace.attribute." in the search bar
    Then the dropdown lists discovered trace-attribute keys ranked by frequency

  Scenario: Typing span.attribute. opens span-attribute key discovery
    When the user types "span.attribute." in the search bar
    Then the dropdown lists discovered span-attribute keys ranked by frequency

  Scenario: Typing event.attribute. opens event-attribute key discovery
    When the user types "event.attribute." in the search bar
    Then the dropdown lists discovered event-attribute keys ranked by frequency

  Scenario: Typing a dynamic-prefix key with colon opens value-mode for that key
    When the user types "trace.attribute.langwatch.origin:" in the search bar
    Then the dropdown opens in value mode for that key
    And the dropdown lists the most-frequent values for that attribute key

  Scenario: Wildcard glob in a dynamic-prefix value matches by prefix
    When the user types "trace.attribute.langwatch.origin:appl*" and presses Enter
    Then traces whose langwatch.origin attribute starts with "appl" are shown

  Scenario: Legacy attribute. form parses but is not suggested
    When the user types "attribute.langwatch.origin:application" and presses Enter
    Then the query parses to the same SQL as "trace.attribute.langwatch.origin:application"
    But the field-mode dropdown does not suggest the bare "attribute." prefix


Rule: Dynamic prefix sidebar parity
  Discovered attribute keys also surface as expandable sections in the sidebar.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces with trace, span, and event attributes

  Scenario: Trace attributes section lives in the Trace group
    Then a "Trace attributes" section appears in the Trace group
    And expanding a key reveals its top values with counts
    And toggling a value writes "@attribute.<key>:<value>" into the search bar

  Scenario: Span attributes section lives in the Span group
    Then a "Span attributes" section appears in the Span group
    And toggling a value writes "@span.attribute.<key>:<value>" into the search bar

  Scenario: Event attributes section lives in the Trace group alongside event names
    Then an "Event attributes" section appears in the Trace group
    And toggling a value writes "@event.attribute.<key>:<value>" into the search bar


Rule: Unknown field handling for typo'd prefixes
  A typo in a dynamic prefix (e.g. "atrace.attribute.x") produces a clear
  parse error rather than a silent empty result.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Typo'd prefix shows the parse error and preserves input
    When the user types "atrace.attribute.x:foo" and presses Enter
    Then the search bar shows a red outline with "Unknown field: atrace.attribute.x"
    And the typed text is preserved for the user to fix
    And no query is executed

  Scenario: Typo'd prefix dropdown surfaces a did-you-mean suggestion
    When the user types "atrace.attribute." in the search bar
    Then the dropdown surfaces "trace.attribute.<key>" as a "Did you mean?" suggestion


# ─────────────────────────────────────────────────────────────────────────────
# EDITING EXISTING TOKENS — DROPDOWN REOPENS IN-PLACE
# ─────────────────────────────────────────────────────────────────────────────
# Most search-bar work today happens by editing existing chips. Placing the
# cursor inside an already-typed token must reopen the dropdown for that
# token's mode (field vs value vs dynamic-prefix key) — including for
# dynamic prefixes, which is the path the sidebar tooling and saved-query
# loading both produce.

Rule: Editing an existing token reopens the dropdown
  The dropdown follows the cursor — placing it inside any existing token
  opens the right mode for that token's shape.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Cursor inside the field part of a static chip opens field mode
    Given the search bar contains "@status:error"
    When the user clicks inside "stat" of the field name
    Then the dropdown reopens in field mode with query "stat"

  Scenario: Cursor inside the value of a static chip opens value mode
    Given the search bar contains "@status:error"
    When the user clicks inside "err" of the value
    Then the dropdown reopens in value mode for field "status" with query "err"
    And the dropdown lists known values for "status"

  Scenario: Cursor inside the value of a dynamic trace-attribute chip opens value mode for that key
    Given the search bar contains "@trace.attribute.langwatch.origin:application"
    When the user clicks inside "app" of the value
    Then the dropdown reopens in value mode for field "trace.attribute.langwatch.origin" with query "app"
    And the dropdown lists discovered values for that attribute key

  Scenario: Cursor inside the key part of a dynamic trace-attribute chip opens key discovery
    Given the search bar contains "@trace.attribute.langwatch.origin:application"
    When the user clicks inside "lang" of the key
    Then the dropdown reopens in key-discovery mode for the trace.attribute prefix
    And the dropdown lists matching trace-attribute keys

  Scenario: Cursor inside the value of a dynamic span-attribute chip opens value mode
    Given the search bar contains "@span.attribute.gen_ai.request.model:gpt-4o"
    When the user clicks inside "gpt" of the value
    Then the dropdown reopens in value mode for field "span.attribute.gen_ai.request.model" with query "gpt"

  Scenario: Cursor inside the value of a dynamic event-attribute chip opens value mode
    Given the search bar contains "@event.attribute.exception.type:ValueError"
    When the user clicks inside "Value" of the value
    Then the dropdown reopens in value mode for field "event.attribute.exception.type" with query "Value"

  Scenario: Wildcard-only value still opens value mode
    Given the search bar contains "@trace.attribute.langwatch.origin:*"
    When the user clicks inside the value
    Then the dropdown reopens in value mode for that key
    And the dropdown lists every discovered value for that key

  Scenario: Cursor moves out of the token via arrow keys closes the dropdown
    Given the search bar contains "@trace.attribute.langwatch.origin:application" with the dropdown open
    When the user presses the right arrow until the cursor sits past the token
    Then the dropdown closes
