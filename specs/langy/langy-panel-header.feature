Feature: Langy panel header controls and title overflow
  As someone chatting with Langy
  I want the panel header controls to sit where I expect
  So that I never confuse "new chat" for "minimise" and a long title never hides them

  # ---------------------------------------------------------------------------
  # ONE line, at the trace explorer search bar's height, a chat app's header,
  # not a masthead. Identity leads: the generated conversation title (the
  # wordmark until one lands), as a LABEL, not a control; no subtitle. Then the
  # actions, new chat, history (its own icon, which swaps the panel BODY to the
  # full-height recents list), a one-click LAYOUT TOGGLE (Dock-to-side when
  # floating, Float when docked, the reverse of the current mode), more, and
  # finally Minimise, always last, held apart by a divider. The overflow menu
  # still lists both layouts explicitly. A long title must never push the
  # controls off-panel.
  #
  # COVERAGE NOTE: the history NAVIGATION is exercised end to end in
  # LangyConversationHistory.integration.test.tsx, and what minimising preserves
  # is exercised in langyPeekMinimize.unit.test.ts. Everything else here is
  # header LAYOUT — control order, labels, pressed state, title truncation —
  # and no test renders the header rail to assert any of it. Those scenarios
  # are parked rather than bound to tests that only prove a neighbouring claim.
  # ---------------------------------------------------------------------------

  @unit @unimplemented
  Scenario: The header is a single line
    Given the Langy panel is open
    Then the header shows one line, the title, then the actions
    And no subtitle renders under the title

  # Dismissing Langy keeps the panel mounted, the conversation intact and the
  # open/closed state across a reload — the launcher orb simply comes back. That
  # is minimising, so the control says minimise. There is deliberately no second
  # "close" beside it: it would be a different name for the same behaviour.
  @unit @unimplemented
  Scenario: Minimise is the rightmost control
    Given the Langy panel is open
    Then the minimise control is the last control in the header
    And it carries a "Minimise" label and tooltip

  @unit
  Scenario: Minimising leaves the conversation and the draft untouched
    Given the Langy panel is open on a conversation with a half-typed message
    When the panel is minimised
    Then the conversation it was showing is still the active one
    And the half-typed message is still there when it reopens

  @unit @unimplemented
  Scenario: New conversation is distinct from minimise
    Given the Langy panel is open
    Then a "New chat" control sits in the actions cluster, apart from the minimise control
    And it carries a "New chat" label and tooltip

  # History is a PLACE, not a menu. The old 340px popover floated over the very
  # conversation it was covering, inside a panel barely wider than itself.
  # Activating the control and reading the list back IS covered; that the
  # message column and composer are REPLACED, and that the control reads as
  # pressed, are not.
  @integration @unimplemented
  Scenario: History replaces the panel body with the recents list
    Given the Langy panel is open
    Then a "Recent chats" icon control sits in the actions cluster
    When the user activates it
    Then the recents list replaces the message column and the composer
    And the control reads as pressed while the list is showing
    And the title itself is a label, not a dropdown trigger

  @integration
  Scenario: Choosing a conversation hands the panel back
    Given the recents list is showing
    When the user opens one of the conversations
    Then the panel returns to the message column on that conversation

  @integration @unimplemented
  Scenario: Leaving the recents list without choosing
    Given the recents list is showing
    When the user activates Back, presses Escape, or starts a new chat
    Then the panel returns to the message column

  @integration @unimplemented
  Scenario: The header rail carries a one-click layout toggle
    Given the Langy panel is open in floating mode
    Then a "Dock to side" control sits on the header rail
    When the panel is docked instead
    Then that control becomes a "Float" control, the reverse of the current mode
    And the overflow menu still offers both the Floating and Sidebar layouts explicitly

  @unit @unimplemented
  Scenario: A long conversation title truncates instead of shoving the controls off-panel
    Given the open conversation has a very long generated title
    When the header renders
    Then the title truncates with an ellipsis
    And the header controls stay pinned and fully visible

  @unit @unimplemented
  Scenario: The full title is available on hover when truncated
    Given the open conversation title is truncated
    When the user hovers the title
    Then the full untruncated title is available as a native tooltip

  @unit @unimplemented
  Scenario: A reduced-motion user still gets a truncating title
    Given the user prefers reduced motion
    And the open conversation has a very long generated title
    Then the title renders as static text that truncates with an ellipsis
