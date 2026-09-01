@support @docs
Feature: Agent Report Discovery Across Access Points
  As a coding agent arriving at LangWatch through any entry point (docs, llms.txt, CLI, MCP)
  I want to learn that I can report issues to the LangWatch team
  So that struggles get reported instead of silently worked around

  # Everywhere except MCP pushes `npx langwatch report` first, because it works
  # with zero setup. Only the MCP server advertises its own report_issue tool.

  @unit
  Scenario: llms.txt carries the report notice
    When an agent fetches the LangWatch docs llms.txt index
    Then a note for agents says issues can be reported with "npx langwatch report"

  @unit
  Scenario: The full docs dump carries the report notice
    When an agent fetches llms-full.txt
    Then the same note for agents appears at the top

  @unit
  Scenario: Key docs entry pages carry a small note for agents
    When a reader reaches the bottom of a main docs entry page (introduction, quick start, CLI, MCP)
    Then a small "For agents" note says issues found while following the page can be reported with "npx langwatch report"

  @unit
  Scenario: The attribution footer carries the report line on every page
    When a reader reaches the bottom of any docs page
    Then a line above the Powered by note tells an AI agent to report issues with "npx langwatch report"
    And following it lands on the support documentation

  @unit
  Scenario: The docs have a page documenting the report command
    When a reader opens the support documentation
    Then it documents how agents and users report issues, the two report modes, and the redaction guarantees
