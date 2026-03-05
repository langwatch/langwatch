Feature: Studio Drawer Migration (Properties Panels to Drawers)
  As a user editing nodes in the optimization studio
  I want to use drawers instead of right-sidebar properties panels
  So that the editing experience is consistent with evaluations-v3 and allows more space for content

  # Context:
  # Currently, selecting a node opens a right-sidebar properties panel with play/expand/close buttons.
  # The panel uses Framer Motion to animate between collapsed (right sidebar) and expanded (centered).
  # In expanded mode, InputPanel renders on the left and OutputPanel on the right.
  #
  # New behavior:
  # - Selecting a node opens a drawer (same drawer system as eval-v3)
  # - Drawer has play and expand buttons at the top
  # - Expand button opens the execution view: drawer content renders in the center,
  #   InputPanel on the left, OutputPanel on the right (reimplementing the visual effect)
  # - This replaces the right-sidebar property panels for LLM, evaluator, and code nodes
  # - Entry/End nodes keep simple drawer editing for field configuration
  # - Other panel types (retriever, custom, prompting_technique) are handled case-by-case
  #
  # Node selection drives drawer state:
  # - ReactFlow's onSelectionChange triggers openDrawer() for the appropriate drawer type
  # - Deselecting closes the drawer via closeDrawer()
  # - The URL-based drawer state is kept in sync with node selection

  Background:
    Given I am on the optimization studio workflow editor

  # --- Node Selection Opens Drawer ---

  @integration
  Scenario: Selecting a node opens a drawer instead of right-sidebar panel
    When I click on an LLM node on the canvas
    Then a drawer opens from the right side
    And the right-sidebar properties panel does not appear
    And the drawer shows the node editing content

  @integration
  Scenario: Selecting an evaluator node opens its drawer
    When I click on an evaluator node on the canvas
    Then the evaluator editor drawer opens
    And the drawer shows evaluator settings and mappings

  @integration
  Scenario: Selecting a code node opens its drawer
    When I click on a code node on the canvas
    Then a drawer opens with the code editor content

  @integration
  Scenario: Deselecting a node closes the drawer
    Given I have a node selected and its drawer open
    When I click on the canvas background
    Then the drawer closes
    And any in-progress edits are auto-applied as local state

  @integration
  Scenario: Selecting a different node switches the drawer content
    Given I have an LLM node selected and its drawer open
    When I click on a different evaluator node
    Then the drawer content switches to show the evaluator editor
    And only one drawer is open at a time

  # --- Drawer Controls (Play + Expand) ---

  @integration
  Scenario: Drawer has play and expand buttons at the top
    Given I have an executable node selected and its drawer open
    Then the drawer header shows a play button
    And the drawer header shows an expand button
    And the drawer header shows a close button

  @integration
  Scenario: Play button executes the node
    Given I have an LLM node drawer open
    When I click the play button in the drawer header
    Then the node execution starts
    And the execution results appear in the output panel

  @integration
  Scenario: Expand button opens the execution view
    Given I have an LLM node drawer open
    When I click the expand button in the drawer header
    Then the drawer content moves to the center of the screen
    And an InputPanel appears on the left side
    And an OutputPanel appears on the right side
    And a dimmed backdrop covers the canvas

  @integration
  Scenario: Pressing Escape closes the expanded execution view
    Given I am in the expanded execution view
    When I press the Escape key
    Then the execution view collapses back to the drawer

  @integration
  Scenario: Clicking the backdrop closes the expanded execution view
    Given I am in the expanded execution view
    When I click on the dimmed backdrop
    Then the execution view collapses back to the drawer

  # --- Entry/End Nodes ---

  @integration
  Scenario: Entry point node opens a drawer with input field configuration
    When I click on the entry point node
    Then a drawer opens showing the entry point input fields
    And I can add, remove, and rename input fields

  @integration
  Scenario: End node opens a drawer with output field configuration
    When I click on the end node
    Then a drawer opens showing the end node output fields
    And I can add, remove, and rename output fields

  # --- Non-Executable Nodes ---

  @integration
  Scenario: Non-executable nodes do not show play button
    When I click on the entry point node
    Then the drawer opens without a play button
    And the expand button is not visible
