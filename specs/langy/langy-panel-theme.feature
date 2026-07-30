Feature: Langy panel theme per color mode
  As someone using Langy in either color mode
  I want the panel to match the app in light mode and keep its ink identity in dark mode
  So that Langy feels native on a light screen and branded on a dark one

  # ---------------------------------------------------------------------------
  # Langy's palette is attached to the app's own semantic tokens through two
  # Chakra conditions: `_langy` (".langy-root &") and `_langyDark`
  # (".dark .langy-root &"). Dark mode carries the marketing site's ink ground
  # (ink-900/950 surfaces, paper-at-alpha text, white/10 hairlines). Light mode
  # deliberately carries NO surface/text/border/accent overrides: inside
  # `.langy-root` the app's standard light tokens apply unchanged, so the panel
  # reads as part of the product, not a beige island.
  #
  # Langy's own namespace (`langy.*`, the identity gradient stops, the data
  # bar colours, the signal grid line) keeps values in BOTH modes: those tokens
  # have no app-level fallback and feed the mark, shimmer and fold.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Light mode inherits the app's standard palette
    Given the app is in light mode
    When Langy renders inside .langy-root
    Then bg.surface, fg and border resolve to the app's own light values
    And no Langy-specific light override exists for surfaces, text, borders or accent ramps

  @unit
  Scenario: Dark mode keeps the ink palette
    Given the app is in dark mode
    When Langy renders inside .langy-root
    Then bg.surface resolves to the ink ground rather than the app's dark surface
    And hairlines resolve to white at alpha

  @unit
  Scenario: The identity tokens exist in both modes
    Given the Langy theme is merged into the app system
    Then the langy.* namespace resolves in light mode and in dark mode
    So the mark gradient, thinking shimmer and data bars always have colour

  @unit
  Scenario: Ambient textures are a dark-mode treatment
    Given the app is in light mode
    Then the panel surface carries no grain and no ambient wash
    Given the app is in dark mode
    Then the signal grid and ambient wash render as before
