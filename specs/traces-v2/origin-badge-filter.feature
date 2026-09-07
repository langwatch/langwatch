# Origin badge — click to filter
#
# Implementation:
#   platform/app/src/features/traces-v2/components/TraceTable/registry/cells/trace/SimpleCells.tsx (OriginCell)
#   platform/app/src/features/traces-v2/components/TraceTable/registry/cells/FilterChip.tsx
#   platform/app/src/features/traces-v2/stores/filterStore.ts (toggleFacet)
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

# Langy's own turns trace into the customer's project (ADR-061), stamped with
# origin "langy". They are not the customer's traffic: on a fresh guided
# project they would be the only rows, on an established one they sit between
# the real requests. The explorer leaves them out server-side unless the query
# names the origin field, so the user still reaches them through the origin
# facet or `origin:langy`. The origin facet keeps counting them so the pick is
# there to make.
#
# Implementation:
#   platform/app/src/server/app-layer/traces/hidden-origins.ts
#   platform/app/src/server/app-layer/traces/trace-list.service.ts (getList, getFacets, getNewCount)
#   platform/app/src/server/app-layer/traces/session-groups.service.ts
#   platform/app/src/server/api/routers/tracesV2.ts (list, sessions, facets, newCount)
#   platform/app/src/features/traces-v2/utils/originDisplay.ts
Rule: Langy's own turns stay out of the explorer until the origin is asked for

  @unit
  Scenario: The list leaves out Langy's turns by default
    Given a project with the customer's traces and Langy's own turns
    When the user opens the trace list with no origin term in the query
    Then the list, the Sessions lens and the new-traces count exclude the "langy" origin
    And the counts of every facet but origin exclude it too

  @unit
  Scenario: The origin facet still offers Langy
    Given a project with the customer's traces and Langy's own turns
    When the facet counts are read with no origin term in the query
    Then the origin facet counts the "langy" origin
    And its row reads "Langy"

  @unit
  Scenario: Naming an origin turns the default off
    Given the query names the origin field, with any value, negated or not
    When the explorer reads the list, the facets or the new-traces count
    Then no origin is hidden beyond what the query itself says

  @integration
  Scenario: Picking Langy in the origin facet shows the turns
    Given a project with one customer trace and one of Langy's own turns
    When the list is read with the default hidden origins
    Then only the customer trace is listed
    When the list is read with "origin:langy" and nothing hidden
    Then only Langy's turn is listed
