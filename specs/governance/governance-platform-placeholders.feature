@governance @platform @placeholder
Feature: Platform placeholders — Insights, Analytics, Signals & Alerts
  Three screens that show the shape of the governance product before
  any of them has a backend: the brief Langy will write, the explore
  surface every chart is meant to compile through, and the registry of
  rules that fire alerts. The query line under the explore chart is a
  sketch of that future language; nothing in the platform parses it yet. They exist so the whole flow can be walked and judged in
  one sitting. Nothing on them stores anything, and nothing on them may
  claim to. A control with no backing does nothing; it never reports
  success. The three sit in a "Platform" group of the governance
  sidebar, behind the same release flag as Costs and Billed, and behind
  the governance view permission.
  Decision: none — placeholder UI, reversible, no stored state.

  Background:
    Given an organization member with the governance view permission
    And "release_ui_ai_governance_enabled" is enabled for the organization

  # ---------------------------------------------------------------------------
  # Reachability — the same gate Costs and Billed already use
  # ---------------------------------------------------------------------------

  @integration
  Scenario: The Platform screens are unreachable with the billed-cost flag off
    Given "release_ui_governance_billed_cost_enabled" is disabled
      for the organization
    When the member cold-loads "/governance/insights",
      "/governance/analytics" or "/governance/signals"
    Then the not-found scene renders
    # Unreachable, not merely unlisted: the nav item is filtered by the
    # same flag, but a route with no guard on its page is a half-gate.

  @integration
  Scenario: The Platform group lists its three entries under one label
    Given "release_ui_governance_billed_cost_enabled" is enabled
      for the organization
    When the member opens the navigation-v2 governance sidebar
    Then a section labelled "Platform" lists "Insights", "Analytics"
      and "Signals & Alerts", in that order, after the ungrouped entries
    # The legacy governance rail lists the same three entries flat; only
    # the v2 sidebar has a grouping affordance. Parity of the LIST is
    # pinned by governance-home-routing.feature; this pins the grouping.

  # ---------------------------------------------------------------------------
  # Insights
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Insights opens on an empty brief with one sentence of promise
    When the member opens "/governance/insights"
    Then the heading reads "Insights"
    And the body says "Every morning a background job reads yesterday's
      traffic and files a couple of high-signal insights: not fifteen a
      day." and nothing longer
    And a "Set up data" action and an "Open Langy" action are offered

  @integration
  Scenario: Open Langy opens the Langy panel
    When the member presses "Open Langy" on the Insights screen
    Then the Langy panel is opened
    # The panel itself renders only where Langy is mounted and enabled
    # for the ambient project; with Langy off the request is a no-op
    # and the screen says nothing about it. Not a success claim.

  @integration
  Scenario: The Setup dialog keeps its edits for the sitting and never claims to save
    When the member presses "Set up data" and changes the schedule
    And presses "Save"
    Then the dialog closes with no confirmation of anything being stored
    And reopening the dialog shows the changed schedule
    # Local state for the sitting. A reload returns the defaults; there
    # is no store behind this dialog yet and no toast may pretend there is.

  @integration
  Scenario: Cancel discards the sitting's edits
    When the member presses "Set up data" and changes the schedule
    And presses "Cancel"
    Then reopening the dialog shows the schedule it had before

  # ---------------------------------------------------------------------------
  # Signals & Alerts
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Signals & Alerts opens on an empty registry
    When the member opens "/governance/signals"
    Then the heading reads "Signals & Alerts"
    And the registry says "No rules scoped here yet. Create one from any
      chart's bell icon."
    And "Insights inbox" links to "/governance/insights"
    And "model providers" links to "/settings/model-providers"

  # ---------------------------------------------------------------------------
  # Analytics
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Analytics opens on the spend-by-department template
    When the member opens "/governance/analytics"
    Then the heading reads "Analytics"
    And the chart is titled "Cost by department · weekly"
    And the chart body says "No data yet"
    And the query line reads "usage | summarize sum(cost) by department, bin(1w)"

  @unit
  Scenario: The query line follows the measure, breakdown and interval
    When the measure is "Requests", the breakdown is "Model" and the
      interval is "Daily"
    Then the query line reads "usage | summarize count() by model, bin(1d)"
    And the chart title reads "Requests by model · daily"
    # Full words in the title and the query, never "dept": the title is
    # copy and the query is meant to be read aloud by the same person.

  @integration
  Scenario: A template rewrites the three controls at once
    When the member picks the "Requests by model" template
    Then the measure reads "Requests", the breakdown "Model" and the
      interval "Daily"
    And the query line reads "usage | summarize count() by model, bin(1d)"
