Feature: Langy persists across in-project navigation
  As a user chatting with Langy while moving around a project
  I want Langy to stay open with my conversation intact when I switch pages
  So that the assistant feels like it travels with me instead of resetting on every click

  # Companion to specs/assistant/langy-baseline.feature ("Mounting and visibility").
  #
  # Today Langy is mounted inside the per-page DashboardLayout, so navigating
  # between project pages tears it down and rebuilds it — closing the panel,
  # dropping the draft, and aborting any in-flight response. This spec pins the
  # intended lifecycle: mount Langy once per project, above the swapping page,
  # so it survives navigation *within* a project and resets only when the
  # project (the URL :project segment) changes. Visibility itself is unchanged.

  Background:
    Given I am signed in with Langy enabled for project "demo"
    And the Langy panel is open on the traces page of "demo"

  # ---------------------------------------------------------------------------
  # Persistence within a project
  # ---------------------------------------------------------------------------

  @integration
  Scenario: The panel stays open when navigating between pages of the same project
    When I navigate from traces to prompts within "demo"
    Then the Langy panel is still open
    And it shows the same conversation it had on the traces page
    And the panel was not remounted or reloaded

  @integration
  Scenario: A half-typed message survives navigation
    Given I have typed a message into Langy but not sent it
    When I navigate from traces to prompts within "demo"
    Then my unsent message is still in the composer

  @integration
  Scenario: An in-flight response keeps streaming across navigation
    Given Langy is streaming a response
    When I navigate from traces to prompts within "demo"
    Then the response continues streaming without being aborted
    And the completed response is visible on the prompts page

  # ---------------------------------------------------------------------------
  # Reset boundary: the project
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Switching projects resets Langy
    When I switch to a different project "acme"
    Then Langy starts fresh for "acme"
    And no conversation or in-flight response from "demo" carries over

  # ---------------------------------------------------------------------------
  # Visibility is unchanged by the move
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Langy is absent outside project routes
    When I navigate to a non-project route such as "/settings"
    Then Langy is not mounted
    And no Langy handle or panel is visible

  @integration
  Scenario: The visibility gate is not widened
    # Persistence must not change *who* sees Langy. The existing gate still
    # applies (staff + release_langy_enabled, on project routes the user
    # belongs to) — it has only moved up a level, not loosened.
    Given a user for whom Langy was not previously visible
    When they navigate within a project
    Then Langy remains hidden for them
