Feature: Studio LLM Node Drawer
  As a user working with LLM nodes in the optimization studio
  I want the LLM node to use the same drawer-based prompt editor as evaluations-v3
  So that I have a consistent editing experience and can leverage local state / save patterns

  # Context:
  # Currently, the LLM (signature) node uses SignaturePropertiesPanel, a complex right-sidebar
  # form that syncs directly to node data via debounced setNode(). There is no concept of
  # "saving" or "local state" — changes immediately affect the node.
  #
  # New behavior:
  # - Drag-and-drop LLM node from sidebar creates a new unsaved prompt ("New Prompt")
  # - The node stores a reference to a prompt (prompts/<id>) plus optional localPromptConfig
  # - Clicking the node opens the PromptEditorDrawer (same as eval-v3)
  # - The drawer has Apply (keep local) and Save (persist to DB) buttons at the bottom
  # - Users can also pick an existing prompt from the prompt library
  # - The node shows an orange dot when local changes exist
  # - Execution uses localPromptConfig if present, otherwise the saved prompt version
  #
  # Backward compatibility:
  # - Old workflows with inline LLM config (parameters array) continue to work as-is
  # - The inline config is shown in the drawer for editing
  # - When user clicks "Save" on an inline node, it creates a DB prompt and migrates
  # - A separate "Save as Prompt" action is available — no surprise side effects

  Background:
    Given I am on the optimization studio workflow editor

  # --- Drag and Drop Creates New Prompt ---

  @integration
  Scenario: Dragging LLM node to canvas creates a new unsaved prompt
    When I drag the "LLM" item from the sidebar onto the canvas
    Then an LLM node is created on the canvas with name "New Prompt"
    And the node does not yet reference a saved DB prompt
    And the node has default LLM settings as local state
    And the prompt editor drawer opens automatically

  @integration
  Scenario: Saving the new prompt from the drawer creates a DB record
    Given I have dragged a new LLM node onto the canvas
    And the prompt editor drawer is open with default content
    When I edit the prompt messages
    And I click "Save" in the drawer
    Then a new prompt is created in the database
    And the LLM node references the created prompt (prompts/<id>)
    And the local state is cleared
    And the unsaved changes indicator disappears

  # --- Selecting Existing Prompt ---

  @integration
  Scenario: User can select an existing prompt from the library
    Given I have an LLM node on the canvas
    When I open the LLM node drawer
    And I click on the prompt source selector
    Then I can browse and select an existing prompt from my project
    When I select a prompt
    Then the LLM node references the selected prompt
    And the drawer shows the selected prompt's content

  # --- Local State for LLM Nodes ---

  @integration
  Scenario: Editing prompt messages creates local state
    Given I have an LLM node referencing a saved prompt
    When I open the drawer and edit the prompt messages
    Then the changes are stored as localPromptConfig on the workflow node
    And the saved prompt in the database is not modified
    And the node shows an unsaved changes indicator

  @integration
  Scenario: Changing LLM model creates local state
    Given I have an LLM node referencing a saved prompt
    When I open the drawer and change the LLM model
    Then the model change is stored in localPromptConfig
    And the saved prompt retains its original model setting

  @integration
  Scenario: Changing temperature or other LLM parameters creates local state
    Given I have an LLM node referencing a saved prompt
    When I open the drawer and change the temperature
    Then the parameter change is stored in localPromptConfig
    And the saved prompt is not modified

  # --- Apply / Save / Discard ---

  @integration
  Scenario: Apply closes drawer and keeps local prompt changes
    Given I have unsaved prompt changes in the drawer
    When I click "Apply"
    Then the drawer closes
    And the local changes remain on the LLM node
    And the orange dot stays visible on the node

  @integration
  Scenario: Save persists prompt changes to DB
    Given I have unsaved prompt changes in the drawer
    When I click "Save"
    Then a new prompt version is created in the database
    And the local state is cleared from the LLM node
    And the orange dot disappears

  @integration
  Scenario: Discard reverts to saved prompt version
    Given I have unsaved prompt changes in the drawer
    When I click "Discard changes"
    Then the local state is cleared
    And the drawer shows the saved prompt version
    And the orange dot disappears

  # --- Input/Output Variables ---

  @integration
  Scenario: Adding input variables updates the node inputs
    Given I have an LLM node with the drawer open
    When I add an input variable "context" of type "str"
    Then the LLM node's inputs on the canvas update to include "context"
    And edges can be connected to the new "context" input handle

  @integration
  Scenario: Adding output variables updates the node outputs
    Given I have an LLM node with the drawer open
    When I add an output variable "summary" of type "str"
    Then the LLM node's outputs on the canvas update to include "summary"

  # --- Execution ---

  @integration
  Scenario: Executing LLM node with local changes uses local config
    Given I have an LLM node with unsaved prompt changes
    When I execute the node
    Then the execution uses the local prompt config (messages, model, parameters)
    And the saved DB prompt version is not used

  @integration
  Scenario: Executing LLM node without local changes uses saved prompt
    Given I have an LLM node referencing a saved prompt with no local changes
    When I execute the node
    Then the execution uses the saved prompt version from the DB

  # --- Backward Compatibility ---

  @unit
  Scenario: Existing workflows with inline LLM config continue to work
    Given a workflow was saved with LLM nodes using the old inline parameter format
    When the workflow loads
    Then the LLM nodes render correctly with their existing configuration
    And the nodes can be edited through the drawer
    And the inline config is shown as editable content

  @integration
  Scenario: Saving inline LLM config as a prompt requires explicit action
    Given I have an LLM node with old inline config (no prompt reference)
    When I open the drawer
    Then I see a "Save as Prompt" action to create a DB record
    And the save action does not happen automatically
    When I click "Save as Prompt"
    Then a new prompt is created in the database
    And the node is updated to reference the new prompt

  # --- Unsaved New Prompt in Workflow ---

  @integration
  Scenario: Unsaved new prompt persists in workflow
    Given I have dragged an LLM node onto the canvas but not saved the prompt
    When the workflow is saved
    Then the LLM node is persisted with its local state (unsaved prompt content)
    And when the workflow is reloaded, the node shows "New Prompt" with an orange dot
    And the user can still save it as a DB prompt later
