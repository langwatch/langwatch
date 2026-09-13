Feature: Avatar initials survive every name we are given
  As anyone looking at a list of people, projects or suites
  I want the initials in an avatar to be the initials of the name
  So that the bubble identifies who or what it stands for, whatever
  alphabet or emoji the name is written in

  # The app used the avatar straight from its component library, whose
  # initials helper is `name.charAt(0)` for the first and last word. In UTF-16
  # an emoji outside the basic plane is two code units, so `charAt(0)` returns
  # half of it — and half a surrogate pair is not a character, so the browser
  # paints a replacement box. Customers do name projects and suites with a
  # leading emoji, and an SSO display name can carry one too.
  #
  # The fix is one avatar of our own that every surface imports, so the
  # library's helper is never reached and there is one place to fix a name we
  # have not thought of yet.

  Rule: The initials are whole characters

    @unit
    Scenario: An emoji outside the basic plane is kept whole
      Given a name that begins with an emoji two code units long
      When the avatar derives its initials
      Then the whole emoji is used, not half of it

    @unit
    Scenario: A character written as several code points is kept together
      Given a name beginning with a flag, a family, or a skin-toned emoji
      When the avatar derives its initials
      Then the whole sequence is used, because that is what a reader sees as
           one character

    @unit
    Scenario: A two-word name still gives two initials
      Given a person named with a first and a last name
      When the avatar derives its initials
      Then it uses the first character of each, exactly as it always did

    @unit
    Scenario: A single-word name gives one initial
      Given a name of one word
      When the avatar derives its initials
      Then it uses that word's first character alone

    @unit
    Scenario: A name of more than two words uses the first and the last
      Given a name of three or more words
      When the avatar derives its initials
      Then it uses the first character of the first word and of the last

    @unit
    Scenario: A blank name has no initials
      Given a name that is empty or only whitespace
      When the avatar derives its initials
      Then there are none, so the avatar shows its generic icon instead of an
           empty bubble

  Rule: Every avatar in the app goes through ours

    @integration
    Scenario: The shared avatar renders the whole emoji
      Given a name beginning with an emoji
      When the shared avatar renders its fallback
      Then the bubble shows that emoji
      And no lone surrogate reaches the page

    @integration
    Scenario: Explicit content is rendered as given
      Given an avatar handed its own content instead of a name
      When it renders
      Then that content is shown untouched, because a caller that has already
           chosen the character is not asking for initials

    # That nothing reaches past it is a lint rule rather than a scenario:
    # biome's noRestrictedImports refuses the library's avatar everywhere but
    # the wrapper, the same way it already refuses its dialog and drawer.
