Feature: Editing a dashboard widget from an agent, and where each widget came from
  An agent edits a custom widget through the update_dashboard_widget MCP tool, over the
  widget REST PATCH. Every widget records its source: a catalogue template, Langy, the code
  editor or the API. The source is stored in the widget definition and shown nowhere yet.

  @unit
  Scenario: An MCP agent updates a widget's name and code
    Given a widget on a dashboard
    When an MCP agent calls update_dashboard_widget with the dashboard id, the widget id, a new name and new code
    Then only the name and code are sent to the widget PATCH
    And the tool returns the updated widget

  @unit
  Scenario: update_dashboard_widget rejects an unknown widget
    When an MCP agent calls update_dashboard_widget with a widget id that is not in the project
    Then the tool returns an error naming the widget id
    And no widget is changed

  @unit
  Scenario: update_dashboard_widget rejects an unknown dashboard
    When an MCP agent calls update_dashboard_widget with a dashboard id that is not in the project
    Then the tool returns an error naming the dashboard id
    And no widget is changed

  @unit
  Scenario: The widget PATCH accepts any one field and keeps the rest
    When a client PATCHes a widget with only its code, or only its description
    Then the request is accepted
    And a PATCH with no field to change is refused

  @unit
  Scenario: A widget created through the API without a source records the API
    When a project API key creates a widget and names no source
    Then the widget's source is "api"

  @unit
  Scenario: A widget Langy creates records Langy as its source
    When Langy's session key creates a widget and names no source
    Then the widget's source is "langy"

  @unit
  Scenario: A widget created with a source stores that source
    When the app creates a widget from catalogue template "errors-per-day"
    Then the widget's source is the catalogue with id "errors-per-day"

  @unit
  Scenario: An update keeps the stored source unless it names one
    Given a widget whose source is the catalogue
    When its code is updated without a source
    Then its source is still the catalogue
    When it is updated with the source "code"
    Then its source is "code"

  @unit
  Scenario: A widget saved before sources existed still reads
    Given a stored widget definition with no source
    Then it parses, and the widget has no source
