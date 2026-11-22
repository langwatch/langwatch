Feature: A shortcut is taught beside the action it operates
  As someone using a product that has keyboard shortcuts
  I want the key shown at its action, in words a screen reader can speak
  So that I learn it where I use it, and hints never invent behaviour

  @integration
  Scenario: A hint shows a chord with plus and alternatives with or
    Given a shortcut with the chords Control F and Meta F
    When the hint renders for Mac and for other platforms
    Then Mac shows the Command chord and other platforms show the Control chord
    And chords with other alternatives show every alternative joined by or

  @integration
  Scenario: A hint is spoken in words and encoded for assistive technology
    Given a shortcut with a scope label
    Then the hint is read as the scope, then the keys joined by plus and or
    And the aria-keyshortcuts value lists every supported chord with ARIA key names

  @integration
  Scenario: A decorative hint adds nothing to the action's name
    Given a hint inside a named action
    Then the action keeps its accessible name
    And the hint is hidden from assistive technology

  @integration
  Scenario: A static key never pulses or listens
    Given a static keycap
    When the reader presses the matching key
    Then it does not change and no key listener is installed

  @integration
  Scenario: A tooltip shows its shortcut on hover and focus without new tab stops
    Given an icon button with a tooltip that has a shortcut
    When the reader hovers or focuses the button
    Then the content and the shortcut appear
    And the button is still the only tab stop, with its click and ref intact

  @integration
  Scenario: A tooltip without a shortcut is unchanged
    Given a tooltip with no shortcut
    Then its content renders alone

  @integration
  Scenario: A hint uses existing neutral tokens in both colour modes
    Given a hint in light and in dark
    Then the keycap takes the muted foreground, surface and border tokens
