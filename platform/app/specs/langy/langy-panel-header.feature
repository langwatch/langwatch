Feature: Langy panel header controls and title overflow
  As someone chatting with Langy
  I want the panel header controls to sit where I expect
  So that I never confuse "new chat" for "close" and a long title never hides them

  # ---------------------------------------------------------------------------
  # The header leads with identity (the conversation title, which doubles as the
  # recents dropdown) and trails with actions. Close is always the last control,
  # held apart by a divider; "new conversation" is a distinct control nowhere
  # near where an X belongs. A long title must never push the controls off-panel.
  # ---------------------------------------------------------------------------

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
