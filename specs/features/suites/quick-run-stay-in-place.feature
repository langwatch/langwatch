Feature: Sidebar Quick Run keeps the user in place
  As a user managing simulations
  I want the sidebar's inline Run button to be a fire-and-forget action
  So that I can launch a run plan without losing my current view or being pulled to the run plan's detail page

  # Issue: https://github.com/langwatch/langwatch/issues/3363
  # Investigation: clicking the inline Run button on a run plan row in
  # SuiteSidebar fires useRunSuite's onRunScheduled callback. That callback
  # lives in SimulationsPage.tsx and currently calls navigateToSuite(slug)
  # whenever the user isn't already on that suite's detail page. The fix
  # drops the navigation entirely — cache invalidation and existing SSE
  # listeners surface the new run in-place without a route change.
  #
  # Out of scope: the "Save and Run" flow from the suite editor drawer
  # (handleRunRequested) which deliberately navigates to the suite detail
  # page so the editor lands on the page that shows the new run.

  Background:
    Given the user is in a project with at least one run plan in the simulations sidebar

  # --- AC1: stays on All Runs after quick-run ---

  @integration @unimplemented
  Scenario: Quick run from the All Runs page keeps the user on All Runs
    Given the user is on the All Runs page at /<projectSlug>/simulations
    When the user clicks the inline Run button on a run plan row in the sidebar
    And the run is scheduled
    Then the URL stays at /<projectSlug>/simulations
    And no navigation toward /<projectSlug>/simulations/run-plans/<slug> fires

  # --- AC2: stays on the currently-viewed run plan detail when running a different plan ---

  @integration @unimplemented
  Scenario: Quick run on a different run plan from a run plan detail page keeps the user on the original detail page
    Given the user is on the run plan detail page at /<projectSlug>/simulations/run-plans/<currentSlug>
    When the user clicks the inline Run button on a different run plan row in the sidebar
    And the run is scheduled
    Then the URL stays at /<projectSlug>/simulations/run-plans/<currentSlug>
    And no navigation toward the newly-run plan fires

  # --- AC3: regression check — running the same plan the user is viewing also stays put ---

  @integration @unimplemented
  Scenario: Quick run on the same run plan the user is viewing keeps the user on that detail page
    Given the user is on the run plan detail page at /<projectSlug>/simulations/run-plans/<slug>
    When the user clicks the inline Run button for that same run plan in the sidebar
    And the run is scheduled
    Then the URL stays at /<projectSlug>/simulations/run-plans/<slug>
    And no navigation call fires

  # --- AC4: sidebar row reflects the new run after quick-run, via SSE/poll cadence ---

  @integration @unimplemented
  Scenario: Sidebar row updates after quick-run without manual refresh
    Given the user is on any page in the simulations area
    When the user clicks the inline Run button on a run plan row in the sidebar
    And the run is scheduled
    Then the run plan summaries query is invalidated
    And the sidebar row for that run plan reflects the new pending run within the existing SSE/poll cadence

  # --- AC5: All Runs main panel shows the new pending batch row without navigation ---

  @integration @unimplemented
  Scenario: All Runs main panel shows the new pending batch after quick-run without page navigation
    Given the user is on the All Runs page at /<projectSlug>/simulations
    When the user clicks the inline Run button on a run plan row in the sidebar
    And the run is scheduled
    Then the new pending batch row appears in the RunHistoryPanel in the main pane
    And the URL stays at /<projectSlug>/simulations

  # --- AC6: Save-and-Run from the editor drawer is untouched ---

  @integration
  Scenario: Save and Run from the suite editor drawer still navigates to the suite detail page
    Given the user has the suite editor drawer open for a run plan
    When the user clicks Save and Run
    And the run is scheduled
    Then the user is navigated to the suite detail page for the saved run plan

  # --- AC7: automated regression test pins the no-navigation invariant ---

  @integration @unimplemented
  Scenario: useRunSuite onRunScheduled does not call the router push API
    Given SimulationsPage is rendered with a spied router
    When useRunSuite's onRunScheduled callback fires for a scheduled run
    Then the router push API is not called toward /<projectSlug>/simulations/run-plans/<slug>
    And the run plan summaries query invalidation is still triggered

  # --- AC8: the success toast offers an explicit, opt-in "View run" action ---
  # Founder (Rogério) compromise: staying in place is kept, but the
  # run-scheduled success toast carries a button so the user can jump to the
  # run plan's detail page on demand instead of being auto-navigated.

  @integration
  Scenario: The run-scheduled success toast offers a View run action that navigates to the run plan detail page
    Given the user is on the All Runs page at /<projectSlug>/simulations
    When the user clicks the inline Run button on a run plan row in the sidebar
    And the run is scheduled with no archived scenarios or targets skipped
    Then a success toast is shown with a "View run" action
    And clicking the "View run" action navigates to the run plan detail page at /<projectSlug>/simulations/run-plans/<slug>

  # --- AC Coverage Map ---
  # AC 1: "stays on All Runs after sidebar quick-run"
  #   -> Scenario: Quick run from the All Runs page keeps the user on All Runs
  # AC 2: "stays on currently-viewed run plan detail when running a different plan"
  #   -> Scenario: Quick run on a different run plan from a run plan detail page keeps the user on the original detail page
  # AC 3: "regression — same-plan quick-run still stays put"
  #   -> Scenario: Quick run on the same run plan the user is viewing keeps the user on that detail page
  # AC 4: "sidebar row reflects new run via SSE/poll cadence, no manual refresh"
  #   -> Scenario: Sidebar row updates after quick-run without manual refresh
  # AC 5: "All Runs main panel shows new pending batch without page navigation"
  #   -> Scenario: All Runs main panel shows the new pending batch after quick-run without page navigation
  # AC 6: "Save-and-Run drawer flow unchanged — still navigates to detail page"
  #   -> Scenario: Save and Run from the suite editor drawer still navigates to the suite detail page
  # AC 7: "automated test covers the no-navigation regression"
  #   -> Scenario: useRunSuite onRunScheduled does not call the router push API
  # AC 8: "success toast carries an opt-in View run action that navigates to the detail page"
  #   -> Scenario: The run-scheduled success toast offers a View run action that navigates to the run plan detail page
