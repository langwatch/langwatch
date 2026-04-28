# Grouping Engine — Gherkin Spec
# Based on PRD-019: Grouping Engine
# Covers: grouping selector, accordion rendering, column aggregates, session grouping,
#         expand/collapse, sorting, filtering, pagination, performance, data gating, keyboard

# ─────────────────────────────────────────────────────────────────────────────
# GROUPING SELECTOR
# ─────────────────────────────────────────────────────────────────────────────

Feature: Grouping selector dropdown
  A toolbar dropdown lets the user switch between flat and grouped table views.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces with varied models, services, users, and sessions

  Scenario: Grouping selector appears in the toolbar
    When the Observe page loads
    Then a grouping dropdown appears in the toolbar to the right of the lens tabs

  Scenario: Grouping selector defaults to flat for All Traces
    When the user views the "All Traces" lens
    Then the grouping dropdown reads "Group: flat"

  Scenario: Grouping selector lists all grouping options
    When the user opens the grouping dropdown
    Then the options are "Flat (no grouping)", "By Session", "By Service", "By User", and "By Model"

  Scenario: Selecting a grouping transforms the table
    When the user selects "By Model" from the grouping dropdown
    Then the table renders as accordion-grouped sections by model
    And the lens enters draft state

  Scenario: Dropdown label reflects the active grouping
    When the user selects "By Service" from the grouping dropdown
    Then the dropdown label updates to "Group: by service"

  Scenario: Selecting flat restores the ungrouped table
    Given the user has selected "By Model" grouping
    When the user selects "Flat (no grouping)" from the grouping dropdown
    Then the table renders as a flat list of traces

# ─────────────────────────────────────────────────────────────────────────────
# LOCKED GROUPING ON BUILT-IN LENSES
# ─────────────────────────────────────────────────────────────────────────────

Feature: Locked grouping on built-in lenses
  Built-in lenses with a fixed grouping dimension lock the selector.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Conversations lens locks grouping to by-session
    When the user views the "Conversations" lens
    Then the grouping dropdown shows "Group: by session" with a lock icon
    And the dropdown is disabled

  Scenario: By Model lens locks grouping to by-model
    When the user views the "By Model" lens
    Then the grouping dropdown shows "Group: by model" with a lock icon
    And the dropdown is disabled

  Scenario: By Service lens locks grouping to by-service
    When the user views the "By Service" lens
    Then the grouping dropdown shows "Group: by service" with a lock icon
    And the dropdown is disabled

  Scenario: By User lens locks grouping to by-user
    When the user views the "By User" lens
    Then the grouping dropdown shows "Group: by user" with a lock icon
    And the dropdown is disabled

  Scenario: Clicking a locked dropdown shows a tooltip
    When the user clicks the locked grouping dropdown on a built-in lens
    Then a tooltip reads "Grouping is fixed for this lens. Create a custom lens to change it."

  Scenario: Errors lens has unlocked grouping defaulting to flat
    When the user views the "Errors" lens
    Then the grouping dropdown is enabled
    And the default grouping is "Flat (no grouping)"

  Scenario: Custom lenses have unlocked grouping showing saved value
    Given a custom lens exists with grouping "By User"
    When the user views that custom lens
    Then the grouping dropdown is enabled
    And the dropdown shows "Group: by user"

  Scenario: Saving a custom lens with a chosen grouping
    Given the user views the "All Traces" lens
    When the user selects "By Model" from the grouping dropdown
    And saves as a new custom lens
    Then the custom lens retains the "By Model" grouping

# ─────────────────────────────────────────────────────────────────────────────
# ACCORDION GROUP RENDERING
# ─────────────────────────────────────────────────────────────────────────────

Feature: Accordion group rendering
  Grouped views render as collapsible accordion sections with aggregate headers.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces spanning multiple models
    And the user selects "By Model" grouping

  Scenario: Groups render as collapsed accordion sections
    Then each distinct model appears as a collapsed group header row
    And the group header rows use the same column grid as trace rows

  Scenario: Group header shows expand toggle and trace count
    Then each group header shows a collapsed toggle icon
    And the group key value in bold
    And the trace count in parentheses in muted text

  Scenario: Group header background distinguishes from trace rows
    Then group header rows have a subtle tinted background

  Scenario: Group headers are sticky within scroll context
    Given a group is expanded with many trace rows
    When the user scrolls within the expanded group
    Then the group header remains sticky at the top of its scroll context

  Scenario: Clicking anywhere on a group header toggles expand/collapse
    When the user clicks on a group header row
    Then the group expands to show its trace rows
    When the user clicks the same group header row again
    Then the group collapses

  Scenario: Hovering a group header highlights it
    When the user hovers over a group header row
    Then the row shows the same hover background as trace rows

# ─────────────────────────────────────────────────────────────────────────────
# COLUMN AGGREGATE FUNCTIONS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Column aggregate functions in group headers
  Each column type displays an automatic aggregate value in the group header.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces with varied durations, costs, tokens, and models
    And a grouping is active

  Scenario: Time column shows the range of the group
    Then the Time column in each group header shows the time range from most recent to oldest trace

  Scenario: Time column shows single timestamp when all traces match
    Given all traces in a group share the same timestamp
    Then the Time column shows that single timestamp

  Scenario: Duration column shows average with prefix
    Then the Duration column in each group header shows "avg " followed by the average duration

  Scenario: Cost column shows sum without prefix
    Then the Cost column in each group header shows the total cost across all traces

  Scenario: Tokens column shows sum without prefix
    Then the Tokens column in each group header shows the total token count

  Scenario: Tokens In and Tokens Out columns show sums
    Then the Tokens In column shows the sum of input tokens
    And the Tokens Out column shows the sum of output tokens

  Scenario: Status column shows error count when errors exist
    Given a group contains traces with errors
    Then the Status column in that group header shows the error count with a warning icon

  Scenario: Status column shows green dot when no errors
    Given a group contains only successful traces
    Then the Status column in that group header shows a green dot

  Scenario: TTFT column shows average with prefix
    Then the TTFT column in each group header shows "avg " followed by the average TTFT

  Scenario: Eval scores column shows average with prefix
    Then the Eval scores column in each group header shows "avg " followed by the average score

  Scenario: Events column shows sum without prefix
    Then the Events column in each group header shows the total event count

  Scenario: Span count column shows average with prefix
    Then the Span count column in each group header shows "avg " followed by the average span count

# ─────────────────────────────────────────────────────────────────────────────
# CATEGORICAL COLUMN AGGREGATES
# ─────────────────────────────────────────────────────────────────────────────

Feature: Categorical column aggregates
  String columns like Service, Model, and User show mode or variant count.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a grouping is active

  Scenario: Categorical column shows value when all traces share it
    Given all traces in a group have the same service name
    Then the Service column in that group header shows that service name

  Scenario: Categorical column shows variant count for multiple values
    Given a group contains traces from three or more distinct services
    Then the Service column shows the variant count with muted text
    And hovering the value shows a tooltip listing the distinct services

  Scenario: Categorical column shows group key when it matches the grouping dimension
    Given the user groups by model
    Then the Model column in each group header shows the group key value

# ─────────────────────────────────────────────────────────────────────────────
# SESSION GROUPING (CONVERSATIONS)
# ─────────────────────────────────────────────────────────────────────────────

Feature: Session grouping for Conversations
  The by-session grouping uses specialized aggregates and a two-line header.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces with session IDs
    And the user views the "Conversations" lens or selects "By Session" grouping

  Scenario: Session group header shows conversation ID and turn count
    Then each group header shows the conversation ID and the turn count labeled as "turns"

  Scenario: Session group header shows wall-clock duration
    Then the Duration column shows the wall-clock span from first to last trace

  Scenario: Session group header shows sum of cost
    Then the Cost column shows the sum of costs across all turns

  Scenario: Session group header shows worst status
    Then the Status column shows the worst status across all turns in the session

  Scenario: Session group header has a summary sub-row
    Then each session group header displays a second sub-row with message counts and metadata

  Scenario: Expanded session group shows turn rows
    When the user expands a session group
    Then the traces appear as numbered turn rows with user and assistant messages

# ─────────────────────────────────────────────────────────────────────────────
# EXPAND AND COLLAPSE BEHAVIOR
# ─────────────────────────────────────────────────────────────────────────────

Feature: Expand and collapse behavior
  Groups start collapsed and can be toggled individually or all at once.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a grouping is active with multiple groups

  Scenario: All groups start collapsed
    Then every group is in the collapsed state

  Scenario: Expanding a group shows its trace rows
    When the user expands a group
    Then the trace rows for that group appear below the header
    And the traces have standard table behavior including click-to-open-drawer and hover states

  Scenario: Multiple groups can be open simultaneously
    When the user expands two different groups
    Then both groups remain expanded

  Scenario: Expand all button opens every group
    When the user clicks "Expand all" in the toolbar
    Then every group expands to show its trace rows

  Scenario: Collapse all button closes every group
    Given several groups are expanded
    When the user clicks "Collapse all" in the toolbar
    Then every group collapses

  Scenario: Expand all and Collapse all buttons only appear when grouping is active
    Given the grouping is set to "Flat (no grouping)"
    Then the "Expand all" and "Collapse all" buttons are not visible in the toolbar

# ─────────────────────────────────────────────────────────────────────────────
# GROUP SORT ORDER
# ─────────────────────────────────────────────────────────────────────────────

Feature: Group sort order
  Groups are sorted by trace count descending; traces within groups follow the lens sort.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a grouping is active

  Scenario: Groups are sorted by trace count descending
    Then the group with the most traces appears first
    And the group with the fewest traces appears last

  Scenario: Traces within a group follow the lens sort column
    When the user expands a group
    Then the traces within it are sorted by the lens sort column in descending order

# ─────────────────────────────────────────────────────────────────────────────
# EMPTY GROUPS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Empty groups after filtering
  Groups with no matching traces are hidden.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a grouping is active

  Scenario: Groups with zero matching traces are hidden
    Given a filter is applied that excludes all traces in a group
    Then that group does not appear in the table

  Scenario: All groups empty after filtering shows empty state
    Given filters are applied that exclude all traces in every group
    Then the table shows "No traces match the current filters"

# ─────────────────────────────────────────────────────────────────────────────
# CONVERSATIONS PRESET REFACTORING
# ─────────────────────────────────────────────────────────────────────────────

Feature: Conversations preset uses the grouping engine
  The Conversations preset is refactored to use the generalized grouping engine internally.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces with session IDs

  Scenario: Conversations preset renders through the accordion engine
    When the user views the "Conversations" lens
    Then the table renders as accordion-grouped sections by session
    And the grouping engine handles the accordion rendering

  Scenario: Conversations preset UX is unchanged
    When the user views the "Conversations" lens
    Then collapsed rows show conversation summary with ID, last message, turns, duration, cost, and status
    And expanded rows show numbered turn rows with user and assistant messages

# ─────────────────────────────────────────────────────────────────────────────
# INTERACTION WITH FILTERS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Grouping interaction with filters
  Filters apply within groups and update group counts dynamically.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user groups by model

  Scenario: Filters apply within groups
    When the user applies a filter for error status
    Then each group shows only its error traces
    And groups with no error traces disappear

  Scenario: Facet counts reflect trace-level counts not group counts
    When a grouping is active
    Then facet counts in the sidebar show trace-level counts

  Scenario: Group trace counts update when filters change
    Given a group header shows a trace count
    When the user applies a filter that reduces the matching traces in that group
    Then the group header trace count updates to reflect the filtered count

# ─────────────────────────────────────────────────────────────────────────────
# INTERACTION WITH PAGINATION
# ─────────────────────────────────────────────────────────────────────────────

Feature: Grouping interaction with pagination
  Pagination operates on groups, not individual traces within groups.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a grouping is active with many groups

  Scenario: Page navigation moves between sets of groups
    When the user navigates to the next page
    Then the next set of groups appears

  Scenario: Large group shows partial traces with show-more link
    Given a group contains more traces than the page size
    When the user expands that group
    Then the group shows a subset of traces with the count of shown vs total
    And a "Show more" link appears inside the group

  Scenario: Show more loads additional traces inline
    Given an expanded group shows partial traces with a "Show more" link
    When the user clicks "Show more"
    Then the next batch of traces loads inline within the group
    And the page does not change

# ─────────────────────────────────────────────────────────────────────────────
# PERFORMANCE
# ─────────────────────────────────────────────────────────────────────────────

Feature: Grouping engine performance
  Group aggregates are server-computed and trace rows are lazily fetched.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a grouping is active

  Scenario: Group aggregates are computed server-side
    When the grouped table loads
    Then group header aggregates are computed via server-side queries
    And the frontend does not aggregate trace rows client-side

  Scenario: Collapsed groups do not fetch trace rows
    When the grouped table loads with all groups collapsed
    Then no trace row data is fetched for any group

  Scenario: Expanding a group triggers a query for its traces
    When the user expands a group
    Then a query fetches that group's trace rows

  Scenario: Expanded group with many traces virtualizes rows
    Given a group has over 100 traces
    When the user expands that group
    Then the trace rows within the group are virtualized

# ─────────────────────────────────────────────────────────────────────────────
# DATA GATING
# ─────────────────────────────────────────────────────────────────────────────

Feature: Data gating for grouping dimensions
  The engine handles missing data, single-value dimensions, and high cardinality.

  Background:
    Given the user is authenticated with "traces:view" permission

  Scenario: Grouping by a dimension with no data shows a message
    Given no traces have a user ID
    When the user selects "By User" grouping
    Then the table shows "No user data found. Traces appear here when they include a user ID."

  Scenario: Single-value dimension shows one group
    Given all traces have the same service name
    When the user selects "By Service" grouping
    Then one group appears with aggregate stats for all traces

  Scenario: High cardinality dimension shows top groups with overflow link
    Given grouping by model produces more than 20 groups
    When the user selects "By Model" grouping
    Then the top 20 groups by trace count are shown
    And a message indicates how many more groups exist
    And a "Show all" link is available to reveal the remaining groups

# ─────────────────────────────────────────────────────────────────────────────
# CONDITIONAL FORMATTING ON GROUP HEADERS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Conditional formatting on group header aggregates
  Aggregate values in group headers respect conditional formatting rules.

  Background:
    Given the user is authenticated with "traces:view" permission
    And conditional formatting is configured for duration
    And a grouping is active

  Scenario: Group header aggregate triggers conditional formatting
    Given a group has an average duration exceeding the configured threshold
    Then the Duration cell in that group header displays the colored background

# ─────────────────────────────────────────────────────────────────────────────
# KEYBOARD NAVIGATION
# ─────────────────────────────────────────────────────────────────────────────

Feature: Keyboard navigation in grouped view
  Arrow keys and Enter navigate and toggle groups and trace rows.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a grouping is active with multiple groups
    And focus is on the grouped table

  Scenario: Enter on a collapsed group header expands it
    Given focus is on a collapsed group header
    When the user presses Enter
    Then the group expands

  Scenario: Enter on an expanded group header collapses it
    Given focus is on an expanded group header
    When the user presses Enter
    Then the group collapses

  Scenario: Up and Down arrows navigate between group headers when collapsed
    Given all groups are collapsed
    When the user presses the Down arrow
    Then focus moves to the next group header
    When the user presses the Up arrow
    Then focus moves to the previous group header

  Scenario: Up and Down arrows navigate trace rows within an expanded group
    Given a group is expanded
    And focus is on a trace row within that group
    When the user presses the Down arrow
    Then focus moves to the next trace row

  Scenario: Left arrow on an expanded group header collapses it
    Given focus is on an expanded group header
    When the user presses the Left arrow
    Then the group collapses

  Scenario: Right arrow on a collapsed group header expands it
    Given focus is on a collapsed group header
    When the user presses the Right arrow
    Then the group expands
