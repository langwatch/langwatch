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
