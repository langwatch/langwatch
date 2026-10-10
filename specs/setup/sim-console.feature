@unit
Feature: One console shell for every haven simulator
  Every simulator haven runs (mailsim, idpsim, storagesim, llmsim, voicesim)
  serves a React console on @langwatch/sim-console, so each looks and moves
  the same: a fixed header naming the simulator, its stack and its state, a
  tab bar kept in the address, and list and detail panes (ADR-160).

  # Bound by packages/sim-console/src/__tests__ by their `@scenario` annotations.

  Scenario: The header names the simulator, its stack and its state
    Given a simulator console for the stack "feature-one"
    When the simulator reports that it is serving
    Then the header shows the simulator's name, "feature-one" and the state in words

  Scenario: The open tab is kept in the address
    Given a simulator console with several tabs
    When a tab is picked
    Then the address's hash names that tab
    And opening the console at an address whose hash names a tab opens that tab
    And changing the hash to another tab's name opens that tab

  Scenario: A hash that names no tab leaves the console's own choice open
    Given a simulator console opened at an address whose hash names no tab
    Then the tab the console chose stays open

  Scenario: A list is worked from the keyboard
    Given a simulator console listing several items
    When the reader moves through the list with the arrow keys, Home and End
    Then focus moves from row to row without leaving the list
    And pressing Enter on a row opens that row's detail

  Scenario: A console stops asking while its tab is hidden
    Given a simulator console polling its simulator
    When the browser tab is hidden
    Then the console sends no further requests
    And when the tab is shown again it asks at once and resumes polling

  Scenario: A simulator's answer is parsed, and its refusal is kept in its words
    Given a simulator console reading a simulator's JSON
    When the simulator answers 200
    Then the answer is parsed against the console's schema
    When the simulator answers outside 2xx with {"error": "..."}
    Then the console gets an error carrying the status and the simulator's own message
