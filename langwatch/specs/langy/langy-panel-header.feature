Feature: Langy panel header controls and title overflow
  As someone chatting with Langy
  I want the panel header controls to sit where I expect
  So that I never confuse "new chat" for "close" and a long title never hides them

  # ---------------------------------------------------------------------------
  # ONE line, at the trace explorer search bar's height — a chat app's header,
  # not a masthead. Identity leads: the generated conversation title (the
  # wordmark until one lands), as a LABEL, not a control; no subtitle. Then the
  # actions — new chat, history (its own icon, opening the searchable recents
  # popover), more — and finally Close, always last, held apart by a divider.
  # Layout switching (floating / sidebar) lives in the overflow menu only. A
  # long title must never push the controls off-panel.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The header is a single line
    Given the Langy panel is open
    Then the header shows one line — the title, then the actions
    And no subtitle renders under the title

  @unit
  Scenario: Close is the rightmost control
    Given the Langy panel is open
    Then the close control is the last control in the header
    And it carries a "Close" label and tooltip

  @unit
  Scenario: New conversation is distinct from close
    Given the Langy panel is open
    Then a "New chat" control sits in the actions cluster, apart from the close control
    And it carries a "New chat" label and tooltip

  @integration
  Scenario: History is its own control with a searchable popover
    Given the Langy panel is open
    Then a "Recent chats" icon control sits in the actions cluster
    When the user activates it
    Then the searchable recents popover opens
    And the title itself is a label, not a dropdown trigger

  @unit
  Scenario: The layout switch lives in the overflow menu only
    Given the Langy panel is open
    Then no dock or pop-out control sits on the header rail
    And the overflow menu offers the Floating and Sidebar layouts

  @unit
  Scenario: A long conversation title truncates instead of shoving the controls off-panel
    Given the open conversation has a very long generated title
    When the header renders
    Then the title truncates with an ellipsis
    And the header controls stay pinned and fully visible

  @unit
  Scenario: The full title is available on hover when truncated
    Given the open conversation title is truncated
    When the user hovers the title
    Then the full untruncated title is available as a native tooltip

  @unit
  Scenario: A reduced-motion user still gets a truncating title
    Given the user prefers reduced motion
    And the open conversation has a very long generated title
    Then the title renders as static text that truncates with an ellipsis
