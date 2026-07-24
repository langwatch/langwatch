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

  # A reload should put me back where I was, not merely leave the panel open on
  # an empty thread. What persists is the panel's own state and WHICH
  # conversation was open — never the working state around it.
  @unit
  Scenario: A full page reload restores the panel exactly as I left it
    Given the Langy panel is open in the floating layout on a conversation
    When I reload the window
    Then the panel is restored open
    And it is restored in the floating layout
    And the conversation I had open is restored, with its messages
    And had I closed it first, a reload would restore it closed
    But my unsent draft and any in-flight turn do not come back

  @unit
  Scenario: A conversation is only restored into the project it belongs to
    Given I had a conversation open in project "demo"
    When I open Langy in a different project
    Then no conversation is restored and I start fresh
    # Conversation ids are project-scoped, so restoring one anywhere else would
    # ask the server for a conversation this project does not have.

  @unit
  Scenario: Starting a new chat is what I come back to
    Given I had a conversation open and then started a new chat
    When I reload the window
    Then I am on the new, empty conversation — not the one before it

  @unit
  Scenario: Nothing follows me into another account
    Given I had a conversation open in project "demo"
    When somebody else signs in and opens the same project on this machine
    Then no conversation is restored and they start fresh
    # A project id is not an identity. A shared machine, a second account or an
    # impersonation session all reach the same project as a different person,
    # and what is remembered lives in the browser rather than with whoever is
    # signed in — so the fence has to be the whole scope (user, organization,
    # project), not the project alone.

  @unit
  Scenario: Nothing follows me into another organization
    Given I had a conversation open in project "demo"
    When I reach that project from a different organization
    Then no conversation is restored and I start fresh

  # ---------------------------------------------------------------------------
  # Coming back to a conversation that has to load
  # ---------------------------------------------------------------------------

  # Restoring is not the same as starting fresh, and the panel already knows
  # which it is doing before the messages arrive: it remembered the
  # conversation. Painting the empty state's invitation over a conversation the
  # reader has already had — and then swapping it out — reads as Langy having
  # forgotten them, and the card resizing underneath makes it worse.

  @unit
  Scenario: A conversation that is still loading never shows the empty invitation
    Given I had a conversation open and I reload the window
    When the panel restores before its messages have arrived
    Then the panel shows a placeholder in the shape of a conversation
    And it never offers "How can I help?" or the starter suggestions
    And the invitation is what a genuinely new chat gets instead

  @unit
  Scenario: A restored conversation opens at the size its content will need
    Given I had a conversation of several messages open
    When I reload and the panel restores before its messages have arrived
    Then the card opens at the size that conversation needs
    And it does not rest at the empty size and grow once the messages land
    # The recents list already carries each conversation's message count, so
    # this is a known quantity, not a guess.

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
