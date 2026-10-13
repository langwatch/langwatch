Feature: Langy mounts with the product pages, not the special screens
  As a reader of the CLI device approval screen
  I want no assistant panel over the confirmation
  So that the screen shows only the approval decision

  Background:
    Given the application's route table

  @unit
  Scenario: The CLI device approval screen carries no assistant panel
    When the route for /cli/auth is matched against the route table
    Then no Langy layout route is among its ancestors
    And a settings route still resolves under the Langy layout route

  @integration
  Scenario: A product page renders inside the Langy layout
    Given the Langy layout route declared by the langy module
    When a project page below it is opened, such as the experiment workbench
    Then the page renders inside the Langy provider, beside the panel
    And the page may register its handlers with the panel rather than throwing
