Feature: Every project switch is the top bar's searchable picker
  As someone with many projects
  I want the project picker on settings pages to search, group and tick like
  the one in the top bar
  So that I can find the project I want from any page, the same way every time

  # Settings-style pages (Project settings, Braids, Secrets, the authorize,
  # MCP authorize and docs-connect pages) drew project's lent switcher, a plain
  # menu ported from main with no search, while the top bar drew navigation's
  # searchable combobox (issue #9731). Both now draw the design system's
  # ProjectPicker; each owner hands it the groups and follows the pick.

  @regression
  Scenario: A settings page shows the top bar's searchable project picker
    Given I am on Project settings with a project in scope
    When I open the project picker in the page header
    Then a search field is focused above the projects, grouped by team
    And the current project carries a tick
    And within one organization each group is titled by its team, as in the top bar

  @regression
  Scenario: Typing filters the projects and Enter switches to the first match
    Given the project picker is open on a settings page
    When I type part of a project or team name and press Enter
    Then only the matching projects are listed, with no "New Project" entry
    And the first match opens, the settings page kept as where to return

  @regression
  Scenario: The picker answers the keyboard alone
    Given the project picker is open
    When I arrow to a project and press Enter
    Then that project opens
    And the first Escape clears my search and the next one closes the picker

  @regression
  Scenario: No project matches the search
    Given the project picker is open on a settings page
    When I type text no project or team name contains
    Then the picker says no projects match that text
    And pressing Enter switches nothing

  @regression
  Scenario: A colleague's personal workspace stays out of the list
    Given I am an admin who may open a colleague's personal workspace by link
    When I open the project picker on a settings page
    Then my own personal workspace is listed
    And my colleague's personal workspace is not

  @regression
  Scenario: A page with no project in scope draws no picker
    Given a borrowing page with no project in scope
    When the page renders its header
    Then it draws no project picker

  @regression
  Scenario: Every project switch is the design system's one picker
    Given the browser sources of every module and the application
    When they are scanned for the picker's own copy
    Then only the design system draws a project picker

  # The project ID is what every SDK and API key setup asks for, and the picker
  # named projects only (issue #9709). Hovering a row now shows that project's
  # ID with a copy button; at rest the picker is unchanged.

  @integration
  Scenario: At rest the picker shows no project IDs
    Given the project picker is open
    And I have not pointed at or arrowed to any project
    Then the current project carries a tick
    And no project ID is shown

  @integration
  Scenario: Hovering the current project shows its ID in place of the tick
    Given the project picker is open
    When I hover the current project
    Then its tick is replaced by its ID, shortened in the middle, with a copy button
    And the shortened ID names the full ID on hover

  @integration
  Scenario: Hovering another project shows that project's ID
    Given the project picker is open
    When I hover a project other than the current one
    Then that project's ID and a copy button are shown
    And the current project keeps its tick

  @integration
  Scenario: Copying a project's ID keeps me on my project with the picker open
    Given I hover a project in the open project picker
    When I click its copy button
    Then the full project ID is written to the clipboard
    And the button says "Copied"
    And the picker stays open and no project is opened

  @integration
  Scenario: Hovering the copy button names what it does
    Given I hover a project in the open project picker
    When I hover its copy button
    Then a tooltip beside the button reads "Copy project ID"
    And after I click it the same tooltip reads "Copied"

  @integration
  Scenario: Clicking the rest of a row still switches project
    Given I hover a project other than the current one
    When I click its name
    Then that project opens

  @integration
  Scenario: The arrow-key highlighted project shows its ID and copies it
    Given the project picker is open
    When I arrow to a project
    Then that project's ID is shown
    And pressing Ctrl+C or Cmd+C in the empty search field copies its full ID
    And no project is opened

  @integration
  Scenario: The browser refuses the clipboard
    Given the browser blocks writing to the clipboard
    When I copy a project's ID from the picker
    Then the button says the ID could not be copied
    And the picker stays open and no project is opened

  @integration
  Scenario: A long project name gives way to the ID
    Given a project with a name too long for the picker
    When I hover it
    Then its name truncates and its ID stays readable
    And the picker keeps its width
