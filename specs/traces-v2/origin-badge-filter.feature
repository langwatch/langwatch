# Origin badge — click to filter
#
# Implementation:
#   langwatch/src/features/traces-v2/components/TraceTable/registry/cells/trace/SimpleCells.tsx (OriginCell)
#   langwatch/src/features/traces-v2/components/TraceTable/registry/cells/FilterChip.tsx
#   langwatch/src/features/traces-v2/stores/filterStore.ts (toggleFacet)
#
# Motivation (round 5): the Origin column rendered a static badge while the
# Model and Label cells were already click-to-filter chips. Make Origin
# consistent — clicking the badge toggles the `origin` facet.

Feature: Origin badge click to filter

  Background:
    Given the user is authenticated with "traces:view" permission
    And the trace table shows the Origin column

  Scenario: Clicking the origin badge toggles the origin facet
    Given a trace row with an origin
    When the user clicks its origin badge
    Then the trace list filters by that origin
    And the row's trace drawer does not open from the same click

  Scenario: Clicking again removes the filter
    Given the list is filtered by an origin via its badge
    When the user clicks a badge for that same origin again
    Then the origin filter is removed

  Scenario: A row with no origin is not a filter affordance
    Given a trace row with no origin value
    Then its origin cell renders a plain badge with no filter action
