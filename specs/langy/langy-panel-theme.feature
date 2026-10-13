Feature: Langy panel theme per color mode
  As someone using Langy in either color mode
  I want its text, surfaces and status colours to follow the shared semantic palette
  So that the panel stays readable and consistent with the rest of the product

  @unit
  Scenario: Both modes inherit the app palette
    Given the Langy theme is merged into the app system
    When Langy renders inside .langy-root in light or dark mode
    Then surfaces, text, borders and status colours use the shared app tokens
    And Langy does not override those tokens with a private palette

  @unit
  Scenario: Identity artwork and semantic data colours coexist
    Given the Langy theme is merged into the app system
    Then the mark and thinking shimmer retain their identity gradient
    And the data bars use semantic accent and control colours
    And answer text and user bubbles use semantic text, surface and border colours

  @unit
  Scenario: Ambient textures are a dark-mode treatment
    Given the app is in light mode
    Then the panel surface carries no grain and no ambient wash
    Given the app is in dark mode
    Then the signal grid and ambient wash render as before
