Feature: Hand a scenario run to the simulations tab that is already open
  As a developer running scenario suites from my terminal or a coding agent
  I want LangWatch to steer the simulations tab I already have open
  So that the SDK stops opening a new tab for every run

  Background:
    Given a project with an API key that holds "scenarios:create"
    And a simulations page that stays connected to the project while it is open

  # ---------------------------------------------------------------------------
  # Presence: the tab tells the server it is alive
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A simulations tab opened by the SDK registers itself
    Given the SDK opened the simulations page with a scenarioTab query param
    When the page is open
    Then a run started on that machine is offered to that tab
    And a tab whose browser died stops being offered runs on its own

  @integration
  Scenario: Presence is refreshed while the subscription stays open
    Given a simulations tab that has been open longer than the presence window
    When the tab is still open, sitting in the background
    Then it is still offered new runs

  @integration
  Scenario: A tab that is only reconnecting keeps its place
    Given a simulations tab that is being offered runs
    When it drops off because it routed to another run
    Then it is still offered runs for a short grace window
    And coming back inside that window restores it outright

  @integration
  Scenario: A tab that really went away stops taking runs
    Given a simulations tab that dropped off
    When the grace window passes without it coming back
    Then it is no longer offered runs
    And the next run opens a browser tab again

  @integration
  Scenario: A simulations tab without a scenario tab key never registers
    Given a user opened the simulations page directly
    When the page is open
    Then a run started from a terminal is never handed to it

  # ---------------------------------------------------------------------------
  # Handoff: the SDK asks whether a tab can take the run
  # ---------------------------------------------------------------------------

  @integration
  Scenario: The handoff is delivered when a tab is listening
    Given a simulations tab is registered for scenario tab key "abc"
    When the SDK posts a browser-tab handoff for key "abc" with a batch URL
    Then the response reports the handoff as delivered
    And that tab is sent to the batch URL

  @integration
  Scenario: The handoff is not delivered when no tab is listening
    Given no simulations tab is registered for scenario tab key "abc"
    When the SDK posts a browser-tab handoff for key "abc"
    Then the response reports the handoff as not delivered
    And no tab is navigated

  @integration
  Scenario: A handoff never crosses projects
    Given a simulations tab is registered for key "abc" in project A
    When an API key for project B posts a handoff for key "abc"
    Then the response reports the handoff as not delivered
    And project A's tab is not navigated

  @integration
  Scenario: The handoff endpoint refuses an unauthenticated caller
    Given a request with no API key
    When it posts a browser-tab handoff
    Then the request is declined
    And the open tab stays where it was

  @integration
  Scenario: The handoff URL must belong to this LangWatch instance
    Given a simulations tab is registered for scenario tab key "abc"
    When the SDK posts a handoff whose URL points at another host
    Then the request is rejected
    And no tab is navigated

  @integration
  Scenario: A handoff sent while the tab was reloading is not lost
    Given a simulations tab is registered for scenario tab key "abc"
    When the SDK posts a handoff and the tab comes back a moment later
    Then the tab that comes back is sent to the run it missed
    And only the first tab back is sent to it
    And a tab that comes back much later is not sent to that stale run

  @integration
  Scenario: Nothing is parked when no tab was listening
    Given no simulations tab is registered for scenario tab key "abc"
    When the SDK posts a browser-tab handoff for key "abc"
    Then a tab opening afterwards is not sent to that run

  # ---------------------------------------------------------------------------
  # The tab follows
  # ---------------------------------------------------------------------------

  @integration
  Scenario: The registered tab navigates to the handed-off run
    Given the simulations page is mounted with scenario tab key "abc"
    When a run is handed to key "abc"
    Then the page routes to that batch URL
    And the user is not interrupted by any notification

  @integration
  Scenario: A navigate payload for another machine is ignored
    Given the simulations page is mounted with scenario tab key "abc"
    When a run is handed to key "xyz"
    Then the page does not navigate

  @integration
  Scenario: A connected tab quietly shows that it is linked to local runs
    Given the simulations page is mounted with scenario tab key "abc"
    When an external set view is open
    Then a badge in the set header says the tab is connected to a local run
    And hovering it explains that new runs will land in this tab
    And a tab opened without a key shows no badge

  @integration
  Scenario: The scenario tab key survives a reload but never leaks into shared links
    Given the SDK opened the simulations page with a scenarioTab query param
    When the page has read the key
    Then the key is kept for this tab only
    And the query param is stripped from the visible URL
