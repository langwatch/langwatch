# Grouping Engine — Gherkin Spec
# Covers: grouping selector, accordion rendering, column aggregates, session grouping,
#         expand/collapse, sorting, filtering, pagination, performance, data gating, keyboard
#
# Audited against `langwatch/src/features/traces-v2/{stores/viewStore.ts,
# components/Toolbar/GroupingSelector.tsx, components/TraceTable/{GroupLensBody.tsx,
# conversationGroups.ts, registry/cells/group/types.ts}}` on 2026-05-01.
# Scenarios that describe behavior not implemented today are tagged `@planned`.

# ─────────────────────────────────────────────────────────────────────────────
# GROUPING SELECTOR
# ─────────────────────────────────────────────────────────────────────────────

Feature: Grouping engine

Rule: Grouping selector dropdown
  A toolbar dropdown lets the user switch between flat and grouped table views.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces with varied models, services, users, and sessions

  Scenario: Grouping selector appears in the toolbar
    When the Observe page loads
    Then a grouping dropdown appears on the right side of the toolbar (Layers icon + chevron)

  Scenario: Grouping selector defaults to flat for the All lens
    When the user views the "All" lens
    Then the grouping selector's active value is "flat"
    And the trigger renders as an outline button (the visual cue for the flat state)

  Scenario: Grouping selector lists all grouping options
    When the user opens the grouping dropdown
    Then the options are "Flat", "By Conversation", "By Service", "By User", and "By Model"

  Scenario: Selecting a grouping transforms the table
    When the user selects "By Model" from the grouping dropdown
    Then the table renders as grouped sections by model
    And the change is recorded as a draft on the active lens (orange dot appears)

  Scenario: Selector trigger reflects the active grouping
    When the user selects a non-flat grouping
    Then the trigger switches to the "subtle" button variant
    And its `aria-label` reads "Group rows — currently <Label>" (e.g. "By Service")
    # The trigger does NOT show a "Group: by X" text label — only an icon + chevron.

  Scenario: Selecting flat restores the ungrouped table
    Given the user has selected "By Model" grouping
    When the user selects "Flat" from the grouping dropdown
    Then the table renders as a flat list of traces

# ─────────────────────────────────────────────────────────────────────────────
# LOCKED GROUPING ON BUILT-IN LENSES
# ─────────────────────────────────────────────────────────────────────────────

@planned
# The current GroupingSelector never disables itself or shows a lock icon.
# Built-in lenses with a fixed grouping dimension (Conversations, By Model)
# can be edited locally just like any other lens — the change shows up as a
# draft (orange dot) and the user can revert.
Rule: Locked grouping on built-in lenses
  Built-in lenses with a fixed grouping dimension lock the selector.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Conversations lens locks grouping to by-conversation
    When the user views the "Conversations" lens
    Then the grouping selector is disabled with a lock icon

  Scenario: By Model lens locks grouping to by-model
    When the user views the "By Model" lens
    Then the grouping selector is disabled with a lock icon

  Scenario: Clicking a locked selector shows a tooltip
    When the user clicks the locked grouping selector on a built-in lens
    Then a tooltip reads "Grouping is fixed for this lens. Create a custom lens to change it."

# Behaviour that IS implemented today around grouping + lenses:

Rule: Grouping is editable on every lens (no lock today)

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Errors lens defaults to flat grouping
    When the user views the "Errors" lens
    Then the grouping selector is enabled and the active value is "flat"

  Scenario: Custom lenses load with their saved grouping
    Given a custom lens exists with grouping "by-user"
    When the user views that custom lens
    Then the grouping selector is enabled and the active value is "by-user"

  Scenario: Saving a custom lens with a chosen grouping
    Given the user views the "All" lens
    When the user selects "By Model" from the grouping dropdown
    And saves the changes as a new custom lens
    Then the new custom lens persists with grouping "by-model"

  Scenario: Changing grouping on a built-in lens marks the lens as dirty
    Given the user views the "All" lens
    When the user picks a non-flat grouping
    Then the "All" tab shows the orange draft dot
    And the menu's "Revert local changes" item becomes enabled

# ─────────────────────────────────────────────────────────────────────────────
# ACCORDION GROUP RENDERING
# ─────────────────────────────────────────────────────────────────────────────

Rule: Group row rendering
  Grouped views render the data via the trace-table shell + group registry.
  Group rows can be expanded to reveal their member traces as an addon.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces spanning multiple models
    And the user selects "By Model" grouping

  Scenario: Groups render as collapsed rows
    Then each distinct model appears as a collapsed group row
    And the columns shown are those defined by the group capability (Service/Model/User label, Traces count, Avg duration, Total cost, Total tokens, Errors)

  Scenario: Group rows start collapsed
    Then `openKeys` starts empty so every group is collapsed by default

  Scenario: Clicking a group row toggles expansion
    When the user clicks a group row
    Then `toggleExpanded(group.key)` runs and the group expands to show its member traces (via the `group-traces` addon)
    When the user clicks the same group row again
    Then the group collapses

  @planned
  # Group rows do not currently use a sticky header within their scroll
  # context — they scroll with the table.
  Scenario: Group headers are sticky within scroll context
    Given a group is expanded with many trace rows
    When the user scrolls within the expanded group
    Then the group header remains sticky at the top of its scroll context

# ─────────────────────────────────────────────────────────────────────────────
# COLUMN AGGREGATE FUNCTIONS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Column aggregates available on group rows
  For service/model/user grouping, the group capability exposes a fixed set
  of columns: a label column, trace count, average duration, total cost,
  total tokens, and error count. Tokens In/Out, TTFT, eval scores, events,
  and span count are NOT aggregated on group rows in this build.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces with varied durations, costs, tokens, and models
    And the user has selected "By Model" / "By Service" / "By User" grouping

  Scenario: Trace count column
    Then the "Traces" column shows the number of traces in the group

  Scenario: Avg duration column
    Then the "Avg Dur" column shows the average duration across the group's traces

  Scenario: Total cost column
    Then the "Total Cost" column shows the sum of `totalCost` across the group's traces

  Scenario: Total tokens column
    Then the "Total Tokens" column shows the sum of `totalTokens` across the group's traces

  Scenario: Errors column
    Then the "Errors" column shows the number of traces with status "error" in the group

  Scenario: Group label column
    Then the first column shows the group key value (the service / model / user) and uses the `dotColorForIndex` palette

  @planned
  # Group rows do not currently expose Time, Tokens In/Out, TTFT, Eval scores,
  # Events, or Span count aggregates. The group capability only ships the six
  # columns above.
  Scenario: Additional aggregate columns on group rows
    Then the group row also exposes Time range, Tokens In, Tokens Out, TTFT, Eval scores, Events, and Span count aggregates

# ─────────────────────────────────────────────────────────────────────────────
# CATEGORICAL COLUMN AGGREGATES
# ─────────────────────────────────────────────────────────────────────────────

@planned
# Categorical aggregates (mode / variant count / hover tooltip listing
# distinct values) are not implemented for service/model/user group rows.
# The label column simply shows the group key as plain text.
Rule: Categorical column aggregates
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

Rule: Conversation grouping (by-conversation)
  The `by-conversation` grouping uses a separate code path
  (`ConversationLensBody` + `groupTracesByConversation`) and exposes
  conversation-level aggregates rather than session-level ones.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces with conversation IDs
    And the user views the "Conversations" lens or selects "By Conversation" grouping

  Scenario: Conversation rows reflect the conversation columns capability
    Then the available columns are Conversation (pinned), Turns, Started, Last Turn, Duration, Cost, Tokens, Model, Service, Status

  Scenario: Conversation row shows turn count
    Then the Turns column shows the number of traces (turns) in the conversation

  Scenario: Conversation row totals duration / cost / tokens
    Then the Duration column shows `totalDuration` (sum of `durationMs`)
    And the Cost column shows `totalCost` (sum of trace costs)
    And the Tokens column shows `totalTokens` (sum of trace tokens)

  Scenario: Conversation row shows worst status
    Then the Status column shows the worst status across the conversation
      (error > warning > ok)

  Scenario: Conversation row shows primary model and service
    Then the Model column shows the most-frequent model across the conversation's traces
    And the Service column shows the service name when all traces share one (else blank)

  Scenario: Only traces with a conversation ID participate
    Then traces without a `conversationId` are skipped when building the conversation groups

  @planned
  # The conversation row does not currently render a second "summary"
  # sub-row with message counts and metadata.
  Scenario: Conversation group header has a summary sub-row
    Then each conversation header displays a second sub-row with message counts and metadata

  Scenario: Expanded conversation group shows turn rows
    When the user enables the "conversation-turns" addon
    Then expanding a conversation reveals its traces as turn rows below the row

# ─────────────────────────────────────────────────────────────────────────────
# EXPAND AND COLLAPSE BEHAVIOR
# ─────────────────────────────────────────────────────────────────────────────

Rule: Expand and collapse behavior
  Groups start collapsed and can be toggled individually.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a grouping is active with multiple groups

  Scenario: All groups start collapsed
    Then every group row is in the collapsed state (`openKeys` is empty)

  Scenario: Expanding a group reveals its member traces
    When the user expands a group
    Then the member traces for that group appear below the row via the `group-traces` addon

  Scenario: Multiple groups can be open simultaneously
    When the user expands two different groups
    Then both groups remain expanded

  @planned
  # The traces toolbar does not have "Expand all" / "Collapse all" buttons
  # for grouped views. Those controls only exist on the trace-drawer
  # waterfall view.
  Scenario: Expand all / Collapse all toolbar buttons
    Given grouping is active
    When the user clicks "Expand all" in the toolbar
    Then every group expands to show its trace rows
    When the user clicks "Collapse all" in the toolbar
    Then every group collapses

# ─────────────────────────────────────────────────────────────────────────────
# GROUP SORT ORDER
# ─────────────────────────────────────────────────────────────────────────────

Rule: Group sort order
  GroupLensBody seeds tanstack-table sorting with the active lens's sort.
  The default sort for service/model/user grouping is "count desc".

  Background:
    Given the user is authenticated with "traces:view" permission
    And a grouping is active

  Scenario: Default sort for group rows is trace count descending
    Given the active lens uses the group capability's default sort
    Then the group with the most traces appears first

  Scenario: User-selected sort drives group order
    Given the lens sort is "cost desc"
    Then groups are ordered by total cost descending

  Scenario: Member traces inside an expanded group inherit the trace ordering
    Given the user expands a group
    Then the member traces are listed in `buildGroups`'s reverse-chronological order (most recent first)
    # Member traces are NOT re-sorted by the lens's sort column today; they
    # follow the descending-timestamp order set in `buildGroups`.

# ─────────────────────────────────────────────────────────────────────────────
# EMPTY GROUPS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Empty groups after filtering
  Groups are derived from the filtered trace list, so a group with no
  matching traces simply isn't built.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a grouping is active

  Scenario: Groups with zero matching traces are not built
    Given a filter is applied that excludes all traces in a group
    Then that group is absent from the rendered set (its key never makes it into `buildGroups`)

  Scenario: No groups at all renders the "No traces to group" message
    Given filters are applied such that no traces remain
    Then `GroupLensBody` renders "No traces to group."

# ─────────────────────────────────────────────────────────────────────────────
# CONVERSATIONS PRESET REFACTORING
# ─────────────────────────────────────────────────────────────────────────────

@planned
# The Conversations lens still uses its own dedicated body
# (`ConversationLensBody`) and `groupTracesByConversation` aggregator —
# it has NOT been refactored onto the shared `GroupLensBody` /
# `buildGroups` pipeline. The two paths produce different aggregate
# shapes (`ConversationGroup` vs `TraceGroup`).
Rule: Conversations preset uses the grouping engine
  The Conversations preset is refactored to use the generalized grouping engine internally.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces with conversation IDs

  Scenario: Conversations preset renders through the shared grouping engine
    When the user views the "Conversations" lens
    Then it renders via `GroupLensBody` instead of its own conversation body

# ─────────────────────────────────────────────────────────────────────────────
# INTERACTION WITH FILTERS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Grouping interaction with filters
  Groups are built from the already-filtered trace list, so filter changes
  propagate to group membership and counts automatically.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user groups by model

  Scenario: Filters apply within groups
    When the user applies a filter (e.g. for error status)
    Then each group is built only from traces that pass the filter
    And groups whose filtered trace set is empty are not rendered

  Scenario: Facet counts reflect trace-level counts not group counts
    When a grouping is active
    Then facet counts in the sidebar show trace-level counts

  Scenario: Group trace counts update when filters change
    Given a group row shows a trace count
    When the user applies a filter that reduces the matching traces in that group
    Then the group's trace count updates on the next render

# ─────────────────────────────────────────────────────────────────────────────
# INTERACTION WITH PAGINATION
# ─────────────────────────────────────────────────────────────────────────────

@planned
# Pagination today operates on the underlying trace list (not on groups).
# Groups are derived client-side from whatever traces are currently loaded;
# there is no "Show more" affordance inside an expanded group.
Rule: Grouping interaction with pagination
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

Rule: Grouping engine performance
  Group aggregates are computed CLIENT-side from the already-loaded trace
  list; expansion does not trigger any additional fetches.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a grouping is active

  Scenario: Group aggregates are computed client-side
    When the grouped table loads
    Then `buildGroups` (or `groupTracesByConversation`) iterates the loaded trace list and produces the aggregates client-side
    And no extra server query is issued for grouping

  Scenario: Outer group rows are virtualised via the trace-table virtualizer
    When many groups are present
    Then `useTraceTableVirtualizer` virtualises the outer group rows

  @planned
  # Group expansion today reuses the already-loaded trace data — no
  # per-group fetch is triggered. Within-group rows are not separately
  # virtualised either.
  Scenario: Collapsed groups do not fetch trace rows
    When the grouped table loads with all groups collapsed
    Then no trace row data is fetched for any group

  @planned
  Scenario: Expanding a group triggers a query for its traces
    When the user expands a group
    Then a query fetches that group's trace rows

  @planned
  Scenario: Expanded group with many traces virtualises member rows
    Given a group has over 100 traces
    When the user expands that group
    Then the trace rows within the group are virtualised

# ─────────────────────────────────────────────────────────────────────────────
# DATA GATING
# ─────────────────────────────────────────────────────────────────────────────

Rule: Data gating for grouping dimensions
  Missing values are bucketed under "(unknown)"; there is no high-cardinality
  cap on the number of groups today.

  Background:
    Given the user is authenticated with "traces:view" permission

  Scenario: Missing dimension values fall back to "(unknown)"
    Given some traces have no user ID
    When the user selects "By User" grouping
    Then those traces are bucketed into a group keyed "(unknown)"

  Scenario: All traces missing a dimension produce a single "(unknown)" group
    Given no traces have a user ID
    When the user selects "By User" grouping
    Then a single "(unknown)" group is rendered with all traces

  Scenario: Single-value dimension shows one group
    Given all traces have the same service name
    When the user selects "By Service" grouping
    Then one group is rendered with aggregate stats for all traces

  @planned
  # `buildGroups` does not cap or sort-truncate the group set; every
  # distinct value becomes a group. There is no "Show all" overflow link
  # for high-cardinality dimensions.
  Scenario: High cardinality dimension shows top groups with overflow link
    Given grouping by model produces more than 20 groups
    When the user selects "By Model" grouping
    Then the top 20 groups by trace count are shown
    And a message indicates how many more groups exist
    And a "Show all" link is available to reveal the remaining groups

  Scenario: Grouping by a dimension with no data shows a message
    Given the resulting group list is empty (e.g. after filtering)
    Then `GroupLensBody` renders "No traces to group."

# ─────────────────────────────────────────────────────────────────────────────
# CONDITIONAL FORMATTING ON GROUP HEADERS
# ─────────────────────────────────────────────────────────────────────────────

@planned
# Conditional formatting is not implemented (see conditional-formatting.feature).
Rule: Conditional formatting on group header aggregates
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

@planned
# `useTraceLensKeyboard` and the page-level shortcuts handle find / density /
# sidebar / drawer keys, but grouped views do not have arrow-key navigation
# between group rows or Enter-to-toggle bindings yet.
Rule: Keyboard navigation in grouped view
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
