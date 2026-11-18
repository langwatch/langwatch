Feature: The project switcher names the current project by its ID
  As someone wiring an SDK or an API key to a project
  I want the project switcher to show the current project's ID and the way
  to its settings and keys
  So that I can check the ID I send against the project I am looking at
  without hunting through the settings menu

  # The ID every SDK and API key setup asks for was shown only on Settings >
  # Project > General, a page only readers who may change the project can open.
  # The switcher listed names alone (issue #9709).

  @integration
  Scenario: The switcher opens on the current project's name and ID
    Given I am in a project
    When I open the project switcher
    Then above the search field it shows the current project's name and ID
    And a button copies the ID

  @integration
  Scenario: The current project header leads to its settings and its API keys
    Given I am in a project I may update
    When I open the project switcher
    Then it links "Project settings" to /settings/project
    And it links "API keys for this project" to the API keys page filtered to this project

  @integration
  Scenario: Following a link from the header closes the switcher
    Given the project switcher is open
    When I follow "Project settings"
    Then the project settings page opens
    And the switcher closes

  @integration
  Scenario: An aggregate project shows its ID but offers no API keys
    Given I am in an aggregate project, which takes no API key
    When I open the project switcher
    Then it shows the project's ID
    And it offers no "API keys for this project" link

  @integration
  Scenario: The keyboard still drives the project list with the header shown
    Given the project switcher is open
    When I type part of a project's name and press Enter
    Then that project opens
    And the search field kept the focus throughout

  @integration
  Scenario: A reader who may not change the project sees its ID, with no dead-end settings link
    Given I may view the project but not update it
    When I open the project switcher
    Then it shows the current project's ID with a copy button
    And it offers no "Project settings" link, because that page needs permission to update the project
