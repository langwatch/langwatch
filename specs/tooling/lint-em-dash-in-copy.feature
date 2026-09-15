Feature: The em-dash-in-copy lint rule
  The em dash is the most recognisable AI writing tic, and the copy guidelines
  ban it from anything a customer reads (dev/docs/best_practices/copywriting.md):
  a comma, a colon, or parentheses says the same thing without it. The rule
  watches JSX text, string literals and template literal text in the browser
  application and a module's web package, and leaves a lone placeholder dash,
  a letters-free literal and everything outside customer copy alone.

  @unit
  Scenario: An em dash inside JSX prose is reported
    Given a component in apps/ui/src renders JSX text with an em dash between words
    When the em-dash-in-copy rule runs over it
    Then it reports emDashInCopy
    And the message quotes an excerpt around the em dash

  @unit
  Scenario: An em dash in a tooltip string is reported
    Given a module's web package holds a tooltip string literal with an em dash
    When the em-dash-in-copy rule runs over it
    Then it reports emDashInCopy

  @unit
  Scenario: A lone em dash table placeholder is left alone
    Given JSX text that is only the em dash used as an empty-cell placeholder
    When the em-dash-in-copy rule runs over it
    Then it reports nothing

  @unit
  Scenario: Server code is outside the rule
    Given the same em-dash string literal in a module's server package
    When the em-dash-in-copy rule runs over it
    Then it reports nothing
