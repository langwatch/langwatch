Feature: Dashboards v2 polish and bring-your-own-AI
  As a project member
  I want an empty board that offers one clear way to start, template cards that
  tell me what I will get, numbers that read correctly, a board that uses my
  screen, and fresh data
  And as a developer using my own AI agent, I want to add widgets to a board
  from Claude Code
  So that I can trust and use the board, and build boards without the UI

  # ---------------------------------------------------------------------------
  # UI polish
  # ---------------------------------------------------------------------------

  @integration
  Scenario: AC1 The empty board has no "Add a block" box
    Given the dashboards flag is on and a member opens a board with no widgets
    Then they see the Ask bar and "Start from a template" with the template cards
    And they do not see the "Add a block" box
    # Evidence: screenshot of an empty board

  @integration
  Scenario: AC10 A non-empty board still offers a way to add a widget
    Given a board with at least one widget
    Then the member can open the question picker from the board to add another widget
    # Evidence: screenshot of a board with widgets and its add control

  @e2e @unimplemented
  Scenario: AC2 Template cards say what the board shows
    Given a member opens a board with no widgets
    Then each question-group template card shows a summary of what the board shows
    And the summary comes from its own field, not the picker's "why" line
    And the summary is not cut off on a 1440px wide screen
    # Evidence: screenshot of the template cards

  @unit @unimplemented
  Scenario: AC3 A status tile without an earlier period says so
    Given the previous period has no traces and the current period has traces
    When the Status widget renders
    Then each tile shows "No earlier data" as its change label instead of "New"
    # Evidence: screenshot of the Status widget

  @unit @unimplemented
  Scenario: AC4 Money has cents
    Then a cost of 0 dollars shows as "$0.00"
    And a cost of 0.0042 dollars shows as "$0.0042"
    And a cost of 0.01 dollars shows as "$0.01"
    And a cost of 1.6 dollars shows as "$1.60"
    And a cost of 999.99 dollars shows as "$999.99"
    And a cost of 1000 dollars shows as "$1K"
    And a cost of 12345 dollars shows as "$12.3K"
    # Evidence: unit test of the formatter and a board screenshot showing a cost

  @e2e @unimplemented
  Scenario: AC5 The board uses a wide screen
    Given a 1440px wide window
    When a member opens a board
    Then the widget grid fills the content area beside the sidebar, less the page padding
    And the page has no horizontal scroll
    # Evidence: screenshot at 1440px

  @unit
  Scenario: AC6 Template tables are shorter than template charts
    When a member creates a board from any template
    Then every table widget is at most 4 grid rows high
    And no two widgets on the board overlap
    # Evidence: unit test over every template, and a board screenshot

  @e2e @unimplemented
  Scenario: AC7 The board shows data age and can refresh
    When a member opens a board with widgets
    Then the header shows when the data was last updated
    And a Refresh control reloads every widget and resets that time
    And the member can choose auto-refresh off, every minute, or every 5 minutes
    # Evidence: screenshot of the header with the time and the refresh menu

  # ---------------------------------------------------------------------------
  # Bring-your-own-AI
  # ---------------------------------------------------------------------------

  @integration
  Scenario: AC8 An MCP agent adds a widget to a board
    Given an MCP client connected with a project API key
    When it calls add_dashboard_widget with a dashboard id, a name, widget code and named LWQL queries
    Then the widget is stored and placed on that dashboard
    And the tool returns the widget id
    And the widget shows on the board in the app
    # Evidence: the MCP call output and a screenshot of the board with the new widget

  @integration
  Scenario: AC8b add_dashboard_widget rejects an unknown dashboard
    Given an MCP client with a project API key
    When it calls add_dashboard_widget with a dashboard id that does not exist in the project
    Then the tool returns an error naming the dashboard id
    And no new widget is left in the project
    # Evidence: the MCP call output and the widget count before and after

  @unit @unimplemented
  Scenario: AC9 The docs explain how to build boards from an agent
    Then the Dashboards docs page has a section that lists the MCP dashboard tools, the widget definition format and the LW widget API
    # Evidence: the docs diff

  # ---------------------------------------------------------------------------
  # Guard rails
  # ---------------------------------------------------------------------------

  @integration @unimplemented
  Scenario: AC11 Existing boards are unaffected
    Given a board created before this change
    Then its widgets keep their stored code, labels and number format
    # Decision: no migration of stored widget code in this PR; new templates only

  # --- AC Coverage Map ---
  # AC 1: "The empty board has no 'Add a block' box" → Scenario: AC1 The empty board has no "Add a block" box
  # AC 2: "Template cards say what the board shows" → Scenario: AC2 Template cards say what the board shows
  # AC 3: "A status tile without an earlier period says so" → Scenario: AC3 A status tile without an earlier period says so
  # AC 4: "Money has cents" → Scenario: AC4 Money has cents
  # AC 5: "The board uses a wide screen" → Scenario: AC5 The board uses a wide screen
  # AC 6: "Template tables are shorter than template charts" → Scenario: AC6 Template tables are shorter than template charts
  # AC 7: "The board shows data age and can refresh" → Scenario: AC7 The board shows data age and can refresh
  # AC 8: "An MCP agent adds a widget to a board" → Scenario: AC8 An MCP agent adds a widget to a board; Scenario: AC8b add_dashboard_widget rejects an unknown dashboard
  # AC 9: "The docs explain how to build boards from an agent" → Scenario: AC9 The docs explain how to build boards from an agent
  # AC 10: "A non-empty board still offers a way to add a widget" → Scenario: AC10 A non-empty board still offers a way to add a widget
  # AC 11: "Existing boards are unaffected" → Scenario: AC11 Existing boards are unaffected
