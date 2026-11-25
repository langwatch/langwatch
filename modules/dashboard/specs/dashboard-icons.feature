Feature: Dashboard icons
  # Owner, 2026-11-25: every dashboard gets an icon, picked Notion-style beside the title, set by
  # Langy when it makes a board from a first prompt, and shown in the sidebar in place of the
  # generic board glyph. The icon is a Lucide name from one allow-list in the dashboard contract;
  # null is the default glyph. Evidence: a haven browser screenshot for UI, the quoted tRPC answer
  # for server rules.

  Background:
    Given a project "Shop" where release_dashboards and the organization's Dashboards area are on

  @unit
  Scenario: The allow-list is one list of about 80 Lucide names
    Then the allow-list holds 80 distinct kebab-case names
    And a name off the list is not an icon

  @unit
  Scenario: A name this release does not know reads as no icon
    Given a stored board whose icon is a name a newer release wrote
    When the board is read
    Then its icon is null

  @integration
  Scenario: A board's icon is chosen from a searchable grid beside the title
    Given a member who may edit a board with no icon
    When they open the icon button beside the title, search "money" and pick "Dollar sign"
    Then boards.update is called with the icon "dollar-sign"

  @integration
  Scenario: The icon can be removed
    Given a member who may edit a board whose icon is "dollar-sign"
    When they open the icon button and choose "Remove icon"
    Then boards.update is called with the icon null

  @integration
  Scenario: A reader who may not edit a board sees its icon, not the button
    Given a board whose icon is "dollar-sign" and a reader who may not edit it
    Then the icon is drawn beside the title
    And there is no "Change icon" button

  @unit
  Scenario: The grid is reachable by keyboard
    Given the picker's grid of 80 icons
    When an arrow key is pressed on an icon
    Then focus moves one icon, or one row for up and down, and stops at the edges

  @integration
  Scenario: The sidebar shows a board's icon in place of the generic glyph
    Given a board whose icon is "dollar-sign" and another with none
    Then the first board's sidebar row draws its icon
    And the second keeps the default glyph

  @integration
  Scenario: The starred list shows the board's icon
    Given a member who starred a board whose icon is "dollar-sign" and another with none
    Then boards.listStarred carries each board's icon
    And the first starred sidebar row draws its icon
    And the second keeps the default glyph

  @integration
  Scenario: A server refuses an icon off the allow-list
    When a member updates or creates a board with the icon "not-an-icon"
    Then the call is refused and the board is unchanged

  @integration
  Scenario: A board's icon is created, updated, reset and read through the API
    When a member creates a board with the icon "chart-line"
    And updates it to "rocket", then to null
    Then each answer, and the list, carry the icon

  @integration
  Scenario: The REST API sets and reads the icon
    When a dashboard is created with the icon "chart-line" and patched with null
    Then the dashboard's icon is "chart-line", then null

  @unit
  Scenario: The CLI passes the icon and clears it
    When "langwatch dashboard create" gets --icon and "update" gets --clear-icon
    Then the API is called with the icon, then with null

  @unimplemented
  Scenario: Langy picks an icon together with the name of a board made from a first prompt
    Given the dashboard-widgets skill
    When Langy creates a dashboard from the user's first prompt
    Then it passes a name from the allow-list as the icon with the name
