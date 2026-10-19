Feature: Design system component catalogue
  As someone building a LangWatch screen
  I want every shared component visible in one workshop
  So that I extend what exists instead of drawing it again

  @unit
  Scenario: Every exported component has a story
    Given the components the design system publishes
    When the catalogue is enumerated
    Then each component file has a story file beside it
    And each directory of components has one story file for the directory

  @unit
  Scenario: Every story renders in light and dark
    Given every story in the design system
    When each is rendered through the package's own provider
    Then it renders in the light colour mode without throwing
    And it renders in the dark colour mode without throwing
