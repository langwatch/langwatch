Feature: The command bar opens the agent it found
  As someone who searched for an agent by name and pressed enter
  I want to land on that agent
  So that the search result is a way in and not a dead link

  Every agent hit in the command bar used to be addressed as
  "?drawer.open=agentViewer&drawer.agentId=...". No drawer has ever answered
  to that name — it was in no registry and had no component — so the address
  bar changed and nothing opened.

  An agent's kind is what decides which editor holds it: code agents open the
  code editor, HTTP agents the HTTP editor, workflow agents the workflow
  editor. Signature agents have no editor of their own, and an id pasted into
  the palette carries no kind at all; both of those land on the agents list,
  where every agent is, rather than on an address that opens nothing.

  @unit
  Scenario: A code agent found by name opens the code editor
    Given a search hit for a code agent
    Then its address opens the code editor on that agent

  @unit
  Scenario: An HTTP agent found by name opens the HTTP editor
    Given a search hit for an HTTP agent
    Then its address opens the HTTP editor on that agent

  @unit
  Scenario: A workflow agent found by name opens the workflow editor
    Given a search hit for a workflow agent
    Then its address opens the workflow editor on that agent

  @unit
  Scenario: An agent with no editor lands on the agents list
    Given a search hit for a signature agent
    Then its address is the agents list and names no drawer

  @unit
  Scenario: A pasted agent id lands on the agents list
    Given an agent id typed into the command bar
    Then its address is the agents list and names no drawer

  @unit
  Scenario: No agent address names the phantom drawer
    Given a search hit for an agent of any kind
    Then its address never names "agentViewer"
