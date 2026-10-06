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

  @integration
  Scenario: AC19 One control sets the range, the grain and the refresh
    Given a member opens a board
    Then the header has one period control showing the range and grain, such as "30d · auto"
    And its menu has three columns: Range, Grain and Refresh, each with a check on the current choice
    And there is no separate auto-refresh control in the header
    # Evidence: screenshot of the open menu

  @unit
  Scenario: AC19b A grain that does not fit the range cannot be picked
    Given a board's range
    Then a grain is offered only when the range divided by that grain stays within the bucket budget
    And 1m is offered for Live, 1h and 24h only
    And 5m is listed but never offered, as LangWatchQL has no five-minute step
    And changing to a range the current grain does not fit sets the grain to auto
    # Decision: shown greyed out rather than hidden, as in the prototype

  @unit @integration
  Scenario: AC19c Live is the last hour, rolling, refreshed every minute
    When the member picks Live
    Then the board reads the last hour at auto grain, which is one-minute buckets
    And the control shows a green dot and "Live"
    And the board refreshes every minute and the window moves forward with each refresh
    And the other refresh choices are greyed out until the member picks another range
    # Decision: Live overrides the refresh choice without changing it; the member's own choice
    # applies again on any other range

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
  # Question picker
  # ---------------------------------------------------------------------------

  @integration
  Scenario: AC12 A picked question adds its widget and seeds Langy
    Given a board with a widget on it, Langy enabled and the member may start a conversation
    When the member opens the picker and picks a question
    Then the picker closes
    And the question's widget is stored on the board below the existing widgets
    And Langy opens with the question's prompt ready to send and not sent
    And the open board is passed as context
    # Evidence: screenshot of the board with the new widget and Langy's drafted prompt

  @integration
  Scenario: AC12b Without Langy a picked question still adds its widget
    Given a board and Langy is not available to the member
    When the member opens the picker
    Then every question is still listed with no "Ask Langy" footer
    And picking one stores its widget on the board and opens no Langy conversation
    # Evidence: screenshot of the picker without Langy and the board with the new widget

  @integration
  Scenario: AC12c A failed add keeps the picker open and does not seed Langy
    Given a board with Langy enabled and the member may start a conversation
    When the member picks a question and the widget write is rejected
    Then the picker stays open
    And no widget is stored on the board
    And Langy opens no conversation
    # Evidence: the failed create call and the still-open picker

  # ---------------------------------------------------------------------------
  # Empty widgets
  # ---------------------------------------------------------------------------

  @unit
  Scenario: AC13 A quiet period does not ask the member to connect a source
    Given a template widget whose source sent data in the last 90 days
    And none of that data falls in the board's period
    Then the widget says there is nothing in this period, naming what it counts
    And it shows no setup button
    # Evidence: a connected project's widget over an empty period

  @unit
  Scenario: AC13b A source that was never set up shows its setup step
    Given a template widget whose source sent no data in the last 90 days
    Then the widget shows that source's setup step and the button to its setup page
    # Evidence: a new project's widget

  @unit
  Scenario: AC13c Every template widget checks its own source
    Then each template widget stores a query that asks whether its source sent data in the last 90 days
    And the widget runs that query only when its own queries return nothing

  @unit
  Scenario: AC14 Reviewer thumbs are named as reviewer thumbs
    Given a template widget that reads thumbs from the annotations table
    Then its name, summary, subtitle and labels say the thumbs come from reviewers in LangWatch
    And none of them call those thumbs feedback from users
    # Decision: the Flight Deck's "User feedback" title stays, as dashboards-v1 AC4 pins it;
    # its empty face no longer says the thumbs come from users

  # ---------------------------------------------------------------------------
  # The catalogue
  # ---------------------------------------------------------------------------

  @unit
  Scenario: AC15 Every widget answers a question from the question tree
    Given the dashboards catalogue
    Then every widget names the tree question it answers and the data it needs
    And every template lists only widgets from the catalogue, none of them twice

  @unit
  Scenario: AC15b A project's preloaded boards never repeat a widget
    Given an agent kind
    When its preloaded templates are resolved for that kind
    Then no widget appears on more than one of those boards

  @unit
  Scenario: AC15c The prototype's boards are the starter set, under the Agent Flight Deck name
    Given the dashboards catalogue
    Then the default template is named "Agent Flight Deck" and is preloaded for every application agent kind
    And coding agents get the six personal boards preloaded instead
    And the library's own templates are in the gallery only
    # Decision: the prototype's Cockpit cards replace the Flight Deck's widgets; the Flight Deck name stays

  @integration
  Scenario: AC16 The picker offers every catalogue widget that has code, grouped by the question tree
    Given the picker is open on a board
    Then each branch of the question tree with a built widget is a section, in tree order
    And each section lists its built widgets by the question they answer
    And picking one stores it on the board under that question, as AC12 describes
    # Decision: a catalogue widget without code is listed as coming soon, and cannot be picked

  @unit @integration
  Scenario: AC17 Every widget and template is listed, coming soon until it is built
    Given the picker or the template gallery is open
    Then every catalogue widget is listed in the picker and every catalogue template in the gallery
    And a widget without code, or a template with any widget without code, says "Coming soon" and cannot be picked
    And a coming-soon template says how many of its widgets are built
    And the templates that can be made today come first

  @unit
  Scenario: AC18 Every widget and template carries a default Langy prompt
    Given the dashboards catalogue
    Then every widget has a prompt that asks its own question over the dashboard period
    And every template has a report prompt that asks each of its widgets' questions
    # Langy drafts the widget's prompt when it is picked (AC12); the template's report prompt is drafted on create next

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
  # AC 19: "One control for range, grain and refresh, with Live" (added by langwatch/tasks#911: the refresh menu moves into the period control) → Scenario: AC19 One control sets the range, the grain and the refresh; Scenario: AC19b A grain that does not fit the range cannot be picked; Scenario: AC19c Live is the last hour, rolling, refreshed every minute
  # AC 11: "Existing boards are unaffected" → Scenario: AC11 Existing boards are unaffected
  # AC 12: "A picked question adds its widget and seeds Langy" (added by langwatch/tasks#911: the picker adds widgets and drafts Langy, no longer only asks) → Scenario: AC12 A picked question adds its widget and seeds Langy; Scenario: AC12b Without Langy a picked question still adds its widget; Scenario: AC12c A failed add keeps the picker open and does not seed Langy
  # AC 13: "An empty widget tells a quiet period from a missing source" (added by langwatch/tasks#911: no rows no longer means not connected) → Scenario: AC13 A quiet period does not ask the member to connect a source; Scenario: AC13b A source that was never set up shows its setup step; Scenario: AC13c Every template widget checks its own source
  # AC 14: "Reviewer thumbs are named as reviewer thumbs" (added by langwatch/tasks#911: the annotations table holds reviewer thumbs, not user feedback) → Scenario: AC14 Reviewer thumbs are named as reviewer thumbs
  # AC 15: "One catalogue of widgets and templates, from the dashboards library" (added by langwatch/tasks#911: the library is the guide for what to build) → Scenario: AC15 Every widget answers a question from the question tree; Scenario: AC15b A project's preloaded boards never repeat a widget; Scenario: AC15c The prototype's boards are the starter set, under the Agent Flight Deck name
  # AC 16: "The picker offers the catalogue" (added by langwatch/tasks#911: the picker moves from answer shapes to the question tree) → Scenario: AC16 The picker offers every catalogue widget that has code, grouped by the question tree
  # AC 17: "Everything is listed, coming soon until built" (added by langwatch/tasks#911) → Scenario: AC17 Every widget and template is listed, coming soon until it is built
  # AC 18: "Default Langy prompts" (added by langwatch/tasks#911) → Scenario: AC18 Every widget and template carries a default Langy prompt
