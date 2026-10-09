@governance @platform @placeholder
Feature: Platform placeholders — Insights, Analytics, Signals & Alerts
  Three screens that show the shape of the governance product before
  any of them has a backend: the brief Langy will write, the explore
  surface every chart is meant to compile through, and the registry of
  rules that fire alerts. The query line under the explore chart is a
  sketch of that future language; nothing in the platform parses it yet.
  They exist so the whole flow can be walked and judged in one sitting.
  Nothing on them stores anything, and nothing on them may
  claim to. A control with no backing does nothing; it never reports
  success. Each screen is marked Preview and its copy stays in the future
  tense: it says what the screen shows today and what is coming, and it
  never describes unbuilt work as something already running. The three sit in a "Platform" group of the governance
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
    Then the heading reads "Insights" and carries a "Preview" badge
    And the body says "A couple of things worth acting on each day, never a
      feed of fifteen. Nothing has been filed here yet." and nothing longer
    And the display line reads "Langy will write your brief here"
    And a "Set up data" action and an "Open Langy" action are offered
    # Future tense throughout: no morning job runs, so no copy may say one
    # does. The two actions are the only ones offered, because the sample
    # inbox they used to sit beside had nothing behind it.

  @integration
  Scenario: The inbox rail is in place at zero
    Then the screen carries a folder rail: Inbox, Stale, Archived, then Alerts and Notifications under a rule
    And every folder counts zero, shown rather than hidden
    And Inbox is the current folder, with Langy's brief as its body
    When the member picks another folder
    Then the body is that folder's one-line empty state
    # Folders are page state, not routes: nothing lives behind them yet.

  @integration
  Scenario: Open Langy opens the Langy panel
    When the member presses "Open Langy" on the Insights screen
    Then the Langy panel is opened
    # The panel itself renders only where Langy is mounted and enabled
    # for the ambient project; with Langy off the request is a no-op
    # and the screen says nothing about it. Not a success claim.

  @integration
  Scenario: The Setup drawer keeps its edits for the sitting and never claims to save
    When the member presses "Set up data" and changes the schedule
    And presses "Save"
    Then the drawer closes with no confirmation of anything being stored
    And reopening the drawer shows the changed schedule
    # Local state for the sitting. A reload returns the defaults; there
    # is no store behind this drawer yet and no toast may pretend there is.

  @integration
  Scenario: The Model row follows Langy's configured model
    When the member presses "Set up data"
    Then the Model row shows the model Langy's own routing resolves for the project
    And offers the same models Langy is allowed to use, through the shared model picker
    # The one control on this drawer that is wired to something real. It
    # reads Langy's gate (feature key "langy.chat"), not a hand-typed name,
    # so a change under Settings > Model Providers follows here unasked.

  @integration
  Scenario: Cancel discards the sitting's edits
    When the member presses "Set up data" and changes the schedule
    And presses "Cancel"
    Then reopening the drawer shows the schedule it had before

  # ---------------------------------------------------------------------------
  # Signals & Alerts
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Signals & Alerts opens on an empty registry
    When the member opens "/governance/signals"
    Then the heading reads "Signals & Alerts" and carries a "Preview" badge
    And the registry says "No rules here yet. Creating one is coming."
    And "Insights inbox" links to "/governance/insights"
    And "model providers" links to "/settings/model-providers"
    # The old line sent the reader to a chart bell icon that was never
    # built. Nothing watches activity yet, so the copy promises no rule
    # firing, no alert notifying and no automation acting.

  # ---------------------------------------------------------------------------
  # Analytics
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Analytics opens on the spend-by-department template
    When the member opens "/governance/analytics"
    Then the heading reads "Analytics" and carries a "Preview" badge
    And the chart is titled "Cost by department · weekly"
    And the chart body says "This chart is not connected to your data yet"
    And the query line reads "usage | summarize sum(cost) by department, bin(1w)"
    # "No data yet" reads as an empty organization. Nothing queries
    # anything, so the body names the real reason instead.

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

  # ---------------------------------------------------------------------------
  # Honesty — every control acts, and the copy claims nothing more
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Every control the Platform screens offer does something when pressed
    When the member opens "/governance/analytics", "/governance/insights"
      or "/governance/signals"
    Then pressing any enabled control on the screen changes what the screen shows
    And no enabled control is offered that answers a press with nothing
    # The Add filter chip on Analytics and the sample-inbox link on
    # Insights were both offered and both did nothing. Signals was excluded
    # from this scan while its header was being restyled, and its two
    # actions stayed inert behind the exclusion. It is in the scan now.

  @integration
  Scenario: The Signals header actions are offered disabled until they do something
    When the member opens "/governance/signals"
    Then "New alert" and "New signal" are shown disabled
    And pressing either changes nothing on the screen
    # A control that looks live and does nothing reads as broken. Disabled,
    # it reads as not yet built, which is the truth. The buttons stay on the
    # page so the header keeps its shape and the reader sees what is coming.

  @integration
  Scenario: The Platform screens describe unbuilt work in the future tense
    When the member opens "/governance/signals", "/governance/analytics"
      or "/governance/insights"
    Then no copy on the screen says that a rule fires, an alert notifies,
      an automation acts, a job runs or a query is executed today
    And each screen names the one thing it does show
