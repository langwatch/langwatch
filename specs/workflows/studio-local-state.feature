Feature: Studio Local State for Evaluators and Agents
  As a user editing evaluator and agent nodes in the optimization studio
  I want local (unsaved) changes that don't immediately affect the global DB record
  So that I can experiment with settings without breaking other workflows or evaluations that reference the same evaluator/agent

  # Context:
  # Evaluators and agents in the studio are DB-backed records (evaluators/<id>, agents/<id>).
  # The same record can be referenced from multiple workflows and from evaluations-v3.
  # Autosaving to DB is dangerous because changes propagate globally.
  #
  # Solution: Follow the eval-v3 pattern for prompt targets:
  # - Local state stored on the workflow node (node.data.localConfig)
  # - Orange dot on canvas node when unsaved changes exist
  # - "Apply" button in drawer to close and keep local changes
  # - "Save" button to persist to DB and clear local state
  # - "Discard" button to revert to the saved DB version
  # - Execution uses localConfig if present, otherwise fetches from DB
  #
  # Local config shape (evaluator):
  #   { name?: string, settings?: Record<string, unknown> }
  # Local config shape (LLM/prompt):
  #   Reuses eval-v3 LocalPromptConfig (llm, messages, inputs, outputs)
  #
  # Execution path:
  #   Frontend merges localConfig into node.data before sending DSL to Python.
  #   Python backend does NOT need changes — it reads the merged data.

  Background:
    Given I am on the optimization studio workflow editor
    And there is an evaluator node on the canvas referencing a saved DB evaluator

  # --- Local State Tracking ---

  @integration
  Scenario: Editing evaluator settings creates local state without saving to DB
    When I open the evaluator node drawer
    And I change a setting value
    Then the change is stored as local state on the workflow node
    And the DB evaluator record is not modified
    And the evaluator node on the canvas shows an unsaved changes indicator

  @integration
  Scenario: Editing evaluator name creates local state
    When I open the evaluator node drawer
    And I change the evaluator name
    Then the name change is stored as local state on the workflow node
    And the DB evaluator record retains its original name

  @integration
  Scenario: Local state persists when closing and reopening the drawer
    Given I have made unsaved changes to the evaluator settings
    And I close the drawer
    When I reopen the evaluator node drawer
    Then the drawer shows my unsaved changes, not the DB version

  # --- Apply Button ---

  @integration
  Scenario: Apply button closes drawer and keeps local changes
    Given I have made unsaved changes to the evaluator settings
    When I click the "Apply" button in the drawer footer
    Then the drawer closes
    And the local changes remain on the workflow node
    And the unsaved changes indicator remains visible on the canvas node

  # --- Save Button ---

  @integration
  Scenario: Save button persists changes to DB and clears local state
    Given I have made unsaved changes to the evaluator settings
    When I click the "Save" button in the drawer
    Then the changes are saved to the DB evaluator record
    And the local state is cleared from the workflow node
    And the unsaved changes indicator disappears from the canvas node

  # --- Discard Button ---

  @integration
  Scenario: Discard button reverts to saved DB version
    Given I have made unsaved changes to the evaluator settings
    When I click the "Discard changes" button
    Then the local state is cleared from the workflow node
    And the drawer shows the saved DB version of the evaluator
    And the unsaved changes indicator disappears from the canvas node

  # --- Unsaved Changes Indicator (Orange Dot) ---

  @integration
  Scenario: Orange dot appears on canvas node when local changes exist
    Given I have no unsaved changes to the evaluator
    Then the evaluator node on the canvas does not show an orange dot
    When I open the drawer and make a change
    And I apply the changes
    Then the evaluator node on the canvas shows an orange dot
    And hovering over the dot shows "Unsaved changes" tooltip

  @unit
  Scenario: Orange dot disappears after saving
    Given the evaluator node has local unsaved changes
    When I save the changes to DB
    Then the orange dot disappears from the canvas node

  @unit
  Scenario: Orange dot disappears after discarding
    Given the evaluator node has local unsaved changes
    When I discard the changes
    Then the orange dot disappears from the canvas node

  # --- Execution Uses Local State ---

  @integration
  Scenario: Running a node with local changes uses the local config
    Given I have unsaved changes to the evaluator settings
    When I execute the workflow
    Then the frontend merges localConfig into the node data before sending to the executor
    And the evaluator runs with the local (unsaved) settings

  @integration
  Scenario: Running a node without local changes uses the DB config
    Given I have no unsaved changes to the evaluator
    When I execute the workflow
    Then the evaluator runs with the settings fetched from the DB

  # --- Drawer Close Without Apply ---

  @integration
  Scenario: Closing drawer without clicking Apply auto-applies local changes
    Given I have made changes to evaluator settings in the drawer
    When I click on the canvas background to close the drawer
    Then the changes are automatically applied as local state
    And the unsaved changes indicator appears on the canvas node
    # Follows the eval-v3 pattern where onLocalConfigChange fires on every edit

  # --- Agent Nodes (Same Pattern) ---

  @integration
  Scenario: Agent node local state follows the same pattern as evaluators
    Given there is an agent node on the canvas referencing a saved DB agent
    When I open the agent node drawer and make changes
    Then the changes are stored as local state on the agent workflow node
    And the DB agent record is not modified
    And the agent node shows an unsaved changes indicator
    And I can apply, save, or discard the changes just like evaluators

  # --- Workflow Persistence ---

  @integration
  Scenario: Local state is saved as part of the workflow
    Given I have unsaved changes to an evaluator node
    When the workflow is saved
    Then the local state is persisted in the workflow definition
    And when the workflow is reloaded, the local state is restored
    And the unsaved changes indicator reappears on the canvas node
