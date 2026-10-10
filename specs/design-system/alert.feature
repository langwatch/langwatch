Feature: Alerts in the design language, light and dark
  As someone reading a LangWatch screen
  I want an alert to look like the surfaces around it
  So that a status reads calmly instead of as a coloured slab

  @unit
  Scenario: An alert wears the card material in either colour mode
    Given an alert with the default variant
    When it is resolved in the light and in the dark colour mode
    Then its ground is the surface in light and the panel in dark
    And its status shows in the hairline and the icon, not in a filled wash

  @unit
  Scenario: Every alert keeps its text readable in both colour modes
    Given every status in every variant
    When each is resolved in the light and in the dark colour mode
    Then its title and description reach AA contrast against its ground and overlapping mesh peaks
    And its icon reaches the non-text contrast minimum

  @unit
  Scenario: A status tints its alert in either colour mode
    Given an alert with the default variant
    When it is resolved in the light and in the dark colour mode
    Then its ground carries a faint wash of its status colour
    And a warning reads orange in both modes

  @unit
  Scenario: A small alert is compact
    Given an alert in the small size
    When it is compared with the default size
    Then its padding, its text and its icon are all smaller
    And its icon still sits on the title's line

  @unit
  Scenario: Status meshes keep their hierarchy and contrast
    Given alerts, banners and toasts in either colour mode
    Then banners have the lightest status mesh and toasts the middle strength
    And the default alert has the strongest mesh of the three surfaces
    And alert variants weaken from solid to surface to subtle to outline
    And banner and toast text reaches AA and their icons reach non-text contrast
