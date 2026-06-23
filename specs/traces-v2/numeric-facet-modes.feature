# Numeric facet modes — Range slider vs Discrete value picker
#
# Design: dev/docs/adr/028-trace-facet-sidebar-presentation-and-perspectives.md
#
# Implementation:
#   langwatch/src/server/app-layer/traces/facet-registry.ts        (RangeFacetDef: integer flag + default mode)
#   langwatch/src/server/app-layer/traces/trace-list.service.ts    (discrete-values descriptor for integer facets)
#   langwatch/src/features/traces-v2/components/FilterSidebar/RangeSection.tsx     (Range mode — existing slider)
#   langwatch/src/features/traces-v2/components/FilterSidebar/FacetSection.tsx     (Discrete mode — reused categorical list)
#   langwatch/src/features/traces-v2/components/FilterSidebar/SidebarSection.tsx   (header mode-toggle icon)
#   langwatch/src/features/traces-v2/components/FilterSidebar/FacetManagerPopover.tsx  (mode picker in the manager)
#   langwatch/src/features/traces-v2/stores/                        (per-project per-facet mode setting, sibling of visibility)
#
# Related specs:
#   specs/traces-v2/search.feature           — owns the Range slider behaviour (Rule: Range facets) and the query syntax
#   specs/traces-v2/facet-perspectives.feature — facet manager organisation; mode is independent of perspective
#
# Motivation: a numeric facet has exactly one presentation today — a double-
# handled slider. For small integer dimensions (prompt version 1..N, span
# count 1..12) a slider is clumsy; users want to tick the specific values that
# exist. Round 5 lets a numeric facet be shown as a Range (slider, the
# default) OR as Discrete (a multi-select list of the integer values present),
# switchable per facet. Discrete reuses the categorical facet machinery, so a
# discrete selection is a value set, not a range.
#
# Decisions:
#   - Two modes, named "Range" and "Discrete".
#   - The mode toggle shows ONLY on numeric facets (descriptor kind = range).
#   - Discrete is enabled ONLY for integer facets with a bounded value set
#     (declared integer + backend distinct-count at or below the threshold).
#   - Discrete reuses the categorical value list and serialises as an exact
#     value set; the backend matches each value as a number, not a string.
#   - Mode is remembered per facet, per project (a sibling of facet
#     visibility), with a registry default — NOT stored in the perspective.

Feature: Numeric facet modes

Rule: A numeric facet can be presented as Range or Discrete
  A facet backed by a numeric column offers two presentations. Range is the
  double-handled slider (owned by search.feature). Discrete lists the integer
  values that exist and lets the user tick any combination of them.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the filter sidebar is shown

  Scenario: Range mode shows the slider
    Given the "Cost" facet is in Range mode
    Then the Cost facet renders a double-handled range slider
    And adjusting it writes a "cost:[from TO to]" range to the query

  Scenario: Discrete mode shows a tickable value list
    Given the "Prompt Version" facet is in Discrete mode
    And the project has traces with prompt versions 1, 2, 3, and 4
    Then the Prompt Version facet lists 1, 2, 3, and 4 as selectable rows with counts
    And no slider is shown for that facet

  Scenario: A discrete selection filters to exactly the ticked values
    Given the "Prompt Version" facet is in Discrete mode
    When the user ticks versions 2 and 4
    Then the trace list shows only traces whose prompt version is 2 or 4
    And the selection is a value set, not a continuous range

Rule: The mode toggle appears only on numeric facets
  The control that switches Range and Discrete is a header icon beside the
  existing search and expand/collapse icons. It is meaningless for categorical
  facets and is hidden there.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the filter sidebar is shown

  Scenario: Numeric facet header offers the mode toggle
    Then the "Span Count" facet header shows a mode-toggle icon
    And it sits beside the facet's search and expand/collapse icons

  Scenario: Categorical facet header has no mode toggle
    Then the "Model" facet header shows no mode-toggle icon

Rule: Discrete is offered only for integer facets with a bounded value set
  Ticking individual values only makes sense for whole numbers with few
  distinct values. Floats and wide-spread integers stay Range-only and never
  expose a Discrete option.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the filter sidebar is shown

  Scenario: A small integer facet can switch to Discrete
    Given the project's traces have only a handful of distinct "Span Count" values
    Then the Span Count mode toggle offers both Range and Discrete

  Scenario: A float facet is Range-only
    Given "Cost" is a non-integer facet
    Then the Cost mode toggle offers only Range
    And Discrete is not selectable for Cost

  Scenario: A wide-spread integer facet is Range-only
    Given the project's traces span a wide range of distinct "Tokens" values
    Then Discrete is not selectable for Tokens
    And the Tokens facet stays on the slider

Rule: A facet's mode is remembered per project, with a registry default
  Mode is a property of the facet and the user's habit, not of the active
  perspective. It persists across reloads and does not change when the user
  switches facet perspective.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the filter sidebar is shown

  Scenario: Facets open in their registry default mode
    Given the user has never changed any numeric facet mode
    Then "Prompt Version" opens in Discrete mode
    And "Duration" opens in Range mode

  Scenario: A chosen mode persists across reloads
    Given the user switches "Span Count" to Discrete
    When the user reloads the page
    Then "Span Count" is still in Discrete mode

  Scenario: Switching perspective does not change a facet's mode
    Given the user has set "Span Count" to Discrete
    When the user switches the facet perspective to "Cost & Performance"
    Then "Span Count" is still in Discrete mode

  Scenario: The facet manager can set a facet's mode
    Given the facet manager is open
    Then each numeric facet offers a Range/Discrete choice
    And changing it there matches the inline header toggle

Rule: Mode toggle button reflects and flips the current mode
  The header toggle is a single button: its aria-label and glyph describe
  the mode it would switch INTO, so the user reads it as "show me the other
  presentation." Pressing it calls onToggle with no argument; the consumer
  computes the new mode and persists it.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a discrete-eligible numeric facet is shown

  @integration
  Scenario: Mode toggle shows the slider glyph when discrete is active
    Given the facet is in Discrete mode
    Then the header toggle is labelled to switch to the range slider
    And the toggle reports aria-pressed=true

  @integration
  Scenario: Clicking the discrete-mode toggle requests range
    Given the facet is in Discrete mode
    When the user clicks the mode toggle
    Then onToggle is called so the consumer flips the mode

  @integration
  Scenario: Mode toggle shows the value-list glyph when range is active
    Given the facet is in Range mode
    Then the header toggle is labelled to switch to the value list
    And the toggle reports aria-pressed=false

  @integration
  Scenario: Clicking the range-mode toggle requests discrete
    Given the facet is in Range mode
    When the user clicks the mode toggle
    Then onToggle is called so the consumer flips the mode

  @integration
  Scenario: Non-eligible facets render no mode toggle at all
    Given a categorical or wide-range numeric facet that does not qualify for Discrete
    Then no mode toggle is rendered in its header
