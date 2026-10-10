@integration
Feature: The prompt studio does not re-render on unrelated store updates

  The studio's tab store is shared across many components. A component that
  reads only its own tab's slice must not re-render, or restart its own
  work, whenever an unrelated part of the store changes — opening a new
  tab, another window's state, or a change belonging to a sibling
  component. Re-rendering on every unrelated update is a render loop
  waiting to happen, and it restarts work (draft creation, an in-flight
  chat) that should only ever run once.

  Scenario: Creating a draft prompt does not put the studio in a render loop
    Given a hook that creates a draft prompt tab
    When an unrelated tab opens elsewhere in the store
    Then the hook's owning component renders once and stays put

  Scenario: Opening a prompt from the URL does not put the studio in a render loop
    Given a hook that opens a prompt named by a URL parameter
    When an unrelated tab opens elsewhere in the store
    Then the hook's owning component renders once and stays put

  Scenario: The prompt tabbed section stays put on an unrelated store update
    Given the prompt tabbed section reading only its own tab's slice of the store
    When the store updates something the section did not select
    Then the section does not re-render

  Scenario: The prompt playground chat stays put on an unrelated store update
    Given the prompt playground chat reading only its own tab's slice of the store
    When the store updates something the chat did not select
    Then the chat does not re-render
