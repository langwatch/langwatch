# Trace tour: the explorer state in the address survives the tour
#
# Implementation:
#   modules/trace/browser/src/ui/sections/explorer/onboarding/spotlights/spotlight-overlay.tsx
#   modules/trace/browser/src/ui/sections/explorer/hooks/use-url-sync.ts (owns the lens/query fragment)
#
# The tour records its current step in the URL fragment as an `sp=` parameter
# beside the lens, query and time window, never in place of them.

@regression
Feature: Trace tour keeps the explorer state in the address

  Background:
    Given the user is authenticated with "traces:view" permission

  @integration
  Scenario: A deep-linked filter survives the first-visit tour
    Given the user opens the traces page for the first time with "#all-traces?q=trace.attribute.laze.agent.id:agt_123" in the address
    When the page tour starts and the user finishes it
    Then the address still carries the lens and the "q" filter
    And a reload applies the same filter to the trace list

  @integration
  Scenario: The tour step sits beside the explorer state
    Given the address fragment carries a lens and a query
    When the page tour moves to a step
    Then the fragment keeps the lens and the query and adds the step

  @integration
  Scenario: The bar-state writer keeps the tour step
    Given the address fragment carries a query and a tour step
    When the explorer rewrites the fragment for its own state
    Then the tour step is still in the fragment

  @integration
  Scenario: A tour step alone still restores the last-used lens
    Given the user last used a built-in lens
    And the address fragment carries only a tour step
    When the traces page loads
    Then the last-used lens is restored
