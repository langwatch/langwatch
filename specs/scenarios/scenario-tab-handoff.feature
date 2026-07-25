Feature: Hand a scenario run to the simulations tab that is already open
  As a developer running scenario suites from my terminal or a coding agent
  I want LangWatch to steer the simulations tab I already have open
  So that the SDK stops opening a new tab for every run

  Background:
    Given a project with an API key that holds "scenarios:create"
    And the simulations page opens an SSE subscription while it is mounted

  # ---------------------------------------------------------------------------
  # Presence: the tab tells the server it is alive
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A simulations tab opened by the SDK registers itself
    Given the SDK opened the simulations page with a scenarioTab query param
    When the page mounts and its SSE subscription connects
    Then a presence entry exists in Redis for that project and scenario tab key
    And the entry carries a TTL so a crashed browser expires on its own

  @integration
  Scenario: Presence is refreshed while the subscription stays open
    Given a simulations tab has been registered for longer than the presence TTL
    When the SSE subscription is still connected
    Then the presence entry is still readable
    And the refresh is driven server-side so background-tab timer throttling cannot expire it

  @integration
  Scenario: A tab that is only reconnecting keeps its place
    Given a simulations tab is registered
    When its subscription ends because the tab routed to another run
    Then the tab is still offered runs for a short grace window
    And reconnecting inside that window restores it outright

  @integration
  Scenario: A tab that really went away stops taking runs
    Given a simulations tab whose subscription ended
    When the grace window passes without it reconnecting
    Then it is no longer offered runs
    And the next run opens a browser tab again

  @integration
  Scenario: A simulations tab without a scenario tab key never registers
    Given a user opened the simulations page directly
    When the page mounts and its SSE subscription connects
    Then no presence entry is written

  # ---------------------------------------------------------------------------
  # Handoff: the SDK asks whether a tab can take the run
  # ---------------------------------------------------------------------------

  @integration
  Scenario: The handoff is delivered when a tab is listening
    Given a simulations tab is registered for scenario tab key "abc"
    When the SDK posts a browser-tab handoff for key "abc" with a batch URL
    Then the response reports the handoff as delivered
    And a navigate payload is broadcast on the project's tenant channel

  @integration
  Scenario: The handoff is not delivered when no tab is listening
    Given no simulations tab is registered for scenario tab key "abc"
    When the SDK posts a browser-tab handoff for key "abc"
    Then the response reports the handoff as not delivered
    And nothing is broadcast

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
    And nothing is broadcast

  @integration
  Scenario: The handoff URL must belong to this LangWatch instance
    Given a simulations tab is registered for scenario tab key "abc"
    When the SDK posts a handoff whose URL points at another host
    Then the request is rejected
    And nothing is broadcast

  @integration
  Scenario: A handoff sent while the tab was reloading is not lost
    Given a simulations tab is registered for scenario tab key "abc"
    When the SDK posts a handoff and the tab reconnects a moment later
    Then the reconnecting subscription is handed the parked run
    And the parked run is handed over only once
    And it expires quickly so a tab opened much later does not jump to a stale run

  @integration
  Scenario: Nothing is parked when no tab was listening
    Given no simulations tab is registered for scenario tab key "abc"
    When the SDK posts a browser-tab handoff for key "abc"
    Then nothing is parked for that key

  # ---------------------------------------------------------------------------
  # The tab follows
  # ---------------------------------------------------------------------------

  @integration
  Scenario: The registered tab navigates to the handed-off run
    Given the simulations page is mounted with scenario tab key "abc"
    When a navigate payload for key "abc" arrives over SSE
    Then the page routes to the batch URL from the payload
    And a toast tells the user the tab followed a new run

  @integration
  Scenario: A navigate payload for another machine is ignored
    Given the simulations page is mounted with scenario tab key "abc"
    When a navigate payload for key "xyz" arrives over SSE
    Then the page does not navigate

  @integration
  Scenario: The user can stop the tab from following
    Given the simulations page followed a run and showed its toast
    When the user chooses to stop following
    Then the tab stops registering presence
    And later runs open their own browser tab again
    And the choice survives a page reload

  @integration
  Scenario: The scenario tab key survives a reload but never leaks into shared links
    Given the SDK opened the simulations page with a scenarioTab query param
    When the page has read the key
    Then the key is kept for this tab only
    And the query param is stripped from the visible URL
