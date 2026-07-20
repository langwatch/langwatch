Feature: Langy persists across in-project navigation
  As a user chatting with Langy while moving around a project
  I want Langy to stay open with my conversation intact when I switch pages
  So that the assistant feels like it travels with me instead of resetting on every click

  # Companion to specs/assistant/langy-baseline.feature ("Mounting and visibility").
  #
  # Langy mounts once per project, above the swapping page, so it survives
  # navigation *within* a project and resets only when the AMBIENT project
  # changes. The ambient project (not the URL :project segment) is the reset
  # boundary on purpose: settings pages carry no project segment but still
  # resolve the project the user is working in, so the panel travels with them
  # into settings and back. Visibility itself is unchanged.

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

  @integration @unimplemented
  Scenario: A half-typed message survives navigation
    # Tracked: needs a draft store wired into LangyContext + a regression test
    # that types into the composer then navigates without sending.
    Given I have typed a message into Langy but not sent it
    When I navigate from traces to prompts within "demo"
    Then my unsent message is still in the composer

  @integration @unimplemented
  Scenario: An in-flight response keeps streaming across navigation
    # Tracked: needs a streaming test that holds an active SSE while the
    # router navigates; today the provider is keyed by project slug, so
    # within-project nav already preserves state but no test pins it.
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
  Scenario: Langy travels into settings and back
    When I navigate to "/settings" while "demo" is my ambient project
    Then the Langy panel is still available
    And returning to a "demo" page keeps the same conversation
    # The panel is not remounted on the way: the ambient project never changed.

  @integration
  Scenario: The visibility gate is not widened
    # Persistence must not change *who* sees Langy. The existing gate still
    # applies (release_langy_enabled, on project routes the user belongs to)
    # — it has only moved up a level, not loosened.
    Given a user for whom Langy was not previously visible
    When they navigate within a project
    Then Langy remains hidden for them
