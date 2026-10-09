Feature: The project bubble shows a whole character
  As someone switching between projects
  I want the colored bubble beside a project to show the first character of
  its name, whatever that character is
  So that a project named with an emoji is as recognisable in the switcher as
  any other

  # Customers name projects with a leading emoji, and the bubble showed a
  # replacement box for them. The cause is UTF-16: an emoji outside the basic
  # plane is two code units, and both the component's own `slice(0, 1)` and
  # the avatar library's `charAt(0)` initials heuristic cut it in half. Half a
  # surrogate pair is not a character, and the browser paints the box.

  @unit
  Scenario: an emoji outside the basic plane survives being taken as an initial
    Given a project whose name begins with an emoji that is two code units long
    When the bubble takes the first character of the name
    Then it takes the whole emoji, not half of it

  @unit
  Scenario: a character built from several code points is kept together
    Given a name beginning with an emoji written as a sequence, such as a flag
          or a family
    When the bubble takes the first character
    Then the whole sequence is taken, because that is what a reader sees as
         one character

  @unit
  Scenario: an ordinary name is unaffected
    Given a project named with plain letters
    When the bubble takes the first character
    Then it is the same letter it has always shown

  @unit
  Scenario: leading whitespace is not the initial
    Given a project name that begins with a space
    When the bubble takes the first character
    Then it takes the first character that is not whitespace, so the bubble is
         never blank for a name that has something in it

  @integration
  Scenario: the bubble renders the emoji rather than a replacement box
    Given a project whose name begins with an emoji
    When the project switcher renders its bubble
    Then the bubble shows that emoji
    And no lone surrogate reaches the page, because the initial is handed to
        the avatar already chosen rather than re-derived from the full name
