@unit
Feature: Code Block Editor component
  As a developer
  I want a reusable CodeBlockEditor component
  So that code editing is consistent across agents, workflows, and other features

  # ============================================================================
  # Component structure
  # ============================================================================

  Scenario: CodeBlockEditor displays code preview
    Given I render a CodeBlockEditor with code "def hello(): pass"
    Then I see a syntax-highlighted preview of the code
    And the preview uses Python syntax highlighting
    And the preview has a dark background

  Scenario: CodeBlockEditor shows edit overlay on hover
    Given I render a CodeBlockEditor with code
    When I hover over the code preview
    Then an "Edit" overlay appears
    And the overlay has a semi-transparent background

  # ============================================================================
  # Code editing modal
  # ============================================================================

  Scenario: Click opens code editor modal
    Given I render a CodeBlockEditor with code
    When I click on the code preview
    Then a full-screen code editor modal opens
    And I see the code in an editable Monaco editor

  Scenario: Modal provides syntax highlighting
    Given the code editor modal is open
    And the language is set to "python"
    Then the editor provides Python syntax highlighting
    And the editor shows line numbers

  Scenario: Save changes from modal
    Given the code editor modal is open
    And I modify the code
    When I click "Save" or press Ctrl+S
    Then the modal closes
    And the onChange callback is called with the new code
    And the preview updates to show the new code

  Scenario: Cancel changes from modal
    Given the code editor modal is open
    And I modify the code
    When I click "Cancel" or press Escape
    Then the modal closes
    And the original code is preserved
    And onChange is NOT called

  # ============================================================================
  # Component props
  # ============================================================================

  Scenario: Required props
    When I use CodeBlockEditor
    Then the following props are required:
      | prop     | type                    | description                |
      | code     | string                  | The code to display/edit   |
      | onChange | (code: string) => void  | Callback when code changes |

  Scenario: Optional props
    When I use CodeBlockEditor
    Then the following props are optional:
      | prop     | type   | default  | description              |
      | language | string | "python" | Syntax highlighting lang |

  Scenario: Controlled component behavior
    Given I render CodeBlockEditor with code="initial"
    When I edit the code to "modified"
    And onChange is called with "modified"
    Then the parent must update the code prop
    And the preview reflects the new value

  # ============================================================================
  # Usage in BasePropertiesPanel
  # ============================================================================

  Scenario: BasePropertiesPanel uses CodeBlockEditor for code fields
    Given a workflow node has a field of type "code"
    When I render the BasePropertiesPanel for this node
    Then it uses CodeBlockEditor to display the code field
    And the code preview is visible
    And clicking opens the code editor modal

  Scenario: Changes in CodeBlockEditor update node parameters
    Given I am editing a code field in BasePropertiesPanel
    When I modify the code and save
    Then the node's parameter value is updated
    And the workflow state reflects the change

  # ============================================================================
  # Usage in Agent drawers
  # ============================================================================

  Scenario: AgentCodeEditorDrawer uses CodeBlockEditor
    When I open the AgentCodeEditorDrawer
    Then it contains a CodeBlockEditor component
    And I can edit the agent's code
    And saving the drawer saves the code to the agent config
