Feature: Browser colours belong to the design system
  Browser presentation names semantic colours so modes resolve consistently.
  Trademark artwork, identity palettes, novelty art and sample payloads retain literal values.

  @unit
  Scenario: Browser colours use semantic tokens outside documented artwork
    Given production browser sources in apps, modules and enterprise modules
    When their colour literals are collected
    Then every literal is in an exact path documented in raw-colour-allowlist.json
    And comments, tests, stories and colours computed from runtime tokens are not colour debt
