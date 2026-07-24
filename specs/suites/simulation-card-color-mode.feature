@unit
Feature: Simulation card completion treatment follows the selected color mode
  As a user reviewing simulation runs in card mode
  I want the established full-card status wash in light mode
  So that completed cards feel cohesive while dark mode keeps its quieter treatment

  Scenario: Light mode restores the full-card completion wash
    Given a completed simulation run is displayed as a card in light mode
    When its status treatment is rendered
    Then the status gradient covers the full card
    And a successful run uses the established layered green wash
    And the card title is white above the status wash

  Scenario: Dark mode keeps the compact status scrim
    Given a completed simulation run is displayed as a card in dark mode
    When its status treatment is rendered
    Then the status gradient rises from the bottom of the card
    And the conversation preview remains outside the strongest part of the scrim
