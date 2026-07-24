Feature: Agent node sync between the workflow DSL and the agent library
  As a user editing a library agent inside a workflow
  I want the drawer, the canvas node, and the saved agent to stay in agreement
  So that what I see is what is saved and what executes

  # A library agent dragged into a workflow exists in three places: the
  # agent record (the durable library copy), the workflow DSL node (the
  # parameters the engine executes), and the drawer editor (the view).
  # The node snapshot is the canonical in-workflow state: the drawer
  # derives from it synchronously (never from the async record fetch),
  # Save writes the submitted values through to the record, the node,
  # and the query cache in one motion, and the record only overwrites
  # the node when it is genuinely newer and there are no local edits.
  # Unsaved edits live on the node as a localConfig draft, autosaved
  # with the workflow.

  Background:
    Given I am logged in
    And a code agent saved in the library
    And the agent is dragged into a workflow as a node

  @integration
  Scenario: Saving keeps the edited code on screen
    Given the agent drawer is open
    When I edit the code and click Save
    Then the editor still shows my edited code after the save completes
    And no refetch or cache state can revert the editor

  @integration
  Scenario: Saving updates what the workflow executes
    Given the agent drawer is open
    When I edit the code and click Save
    Then the node's DSL parameters carry the edited code
    And the agent record carries the edited code

  @integration
  Scenario: Saving syncs the node's inputs and outputs into the agent record
    Given the agent drawer is open
    And I added an input on the node
    When I click Save
    Then the agent record's inputs match the node's inputs

  @integration
  Scenario: The drawer never shows the starter template for a saved agent
    Given the agent record fetch is still loading
    When I open the agent node drawer
    Then the editor shows the code from the node's DSL snapshot
    And the starter template is not shown

  @integration
  Scenario: Unsaved edits survive closing and reopening the drawer
    Given I edited the code without saving
    When I close and reopen the drawer
    Then the editor shows my unsaved edit
    And the Discard button is offered

  @integration
  Scenario: A library change flows into the node when there are no local edits
    Given the agent record was updated elsewhere
    And the node has no unsaved edits
    When the drawer fetches the newer record
    Then the editor and the node's DSL snapshot update to the newer definition

  @integration
  Scenario: Local edits win over a library refresh until saved or discarded
    Given I edited the code without saving
    And the agent record was updated elsewhere
    When the drawer fetches the newer record
    Then the editor keeps my unsaved edit

  @integration
  Scenario: Discard returns to the saved agent definition
    Given I edited the code without saving
    When I click Discard
    Then the editor shows the saved agent's code
    And the unsaved draft is removed from the node
