@mcp @support
Feature: MCP Report Issue Tool
  As a coding agent connected to the LangWatch MCP server
  I want a tool to report problems I hit while using LangWatch
  So that the LangWatch team learns about broken flows without the user copy-pasting sessions

  Background:
    Given the LangWatch MCP server is connected to a coding assistant

  @unit
  Scenario: The report tool is listed with an agent-facing description
    When the assistant lists the available tools
    Then a report_issue tool is present
    And its description tells the agent to use it whenever it struggled with LangWatch or something did not work
    And its description says to ask the user for permission first

  @integration
  Scenario: Reporting an issue through MCP reaches the LangWatch backend
    Given the user approved sending a report
    When the agent calls report_issue with a title and a summary
    Then the report is delivered to the LangWatch reports endpoint marked as coming from MCP
    And the tool responds with the report id and a thank-you note

  @unit
  Scenario: Calls without user approval are rejected with instructions
    When the agent calls report_issue without confirming user approval
    Then the tool returns an error telling the agent to ask the user first

  @unit
  Scenario: Session content passed through MCP is redacted before sending
    When the agent calls report_issue including session content with an API key inside
    Then the delivered payload does not contain the key
    And a redaction marker appears in its place
