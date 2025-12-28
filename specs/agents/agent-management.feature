@unit
Feature: Agent management
  As a user of LangWatch
  I want to create, edit, and manage reusable agents
  So that I can use them across evaluations and other platform features

  # Note: Agents are now only Code or Workflow types.
  # For LLM-based prompts, use the Prompts feature instead.

  # ============================================================================
  # Agent types
  # ============================================================================

  Scenario: Agent types available
    When I create a new agent
    Then I can choose from the following types:
      | type     | description                          |
      | code     | Python code executor                 |
      | workflow | Reference to an existing workflow    |

  # ============================================================================
  # Agent CRUD - Create
  # ============================================================================

  Scenario: Create code-based agent
    Given I am on the agents page
    When I click "New Agent"
    And I select "Code Agent" type
    Then the AgentCodeEditorDrawer opens
    When I enter name "Python Processor"
    And I enter python code that processes input
    And I click "Save"
    Then the agent "Python Processor" is saved to the database
    And the agent appears in the agents list

  Scenario: Create workflow-based agent
    Given I am on the agents page
    And workflow "Complex Pipeline" exists in the project
    When I click "New Agent"
    And I select "Workflow Agent" type
    Then the WorkflowSelectorDrawer opens
    When I select workflow "Complex Pipeline"
    And I enter name "Pipeline Agent"
    And I click "Save"
    Then the agent "Pipeline Agent" is saved with workflowId reference
    And the agent appears in the agents list

  # ============================================================================
  # Agent CRUD - Read/List
  # ============================================================================

  Scenario: View agents list
    Given agents "Code Processor" and "Pipeline Agent" exist
    When I navigate to the agents page
    Then I see a list of agents
    And each agent shows its name, type, and last updated date

  Scenario: Empty state when no agents
    Given no agents exist in the project
    When I navigate to the agents page
    Then I see an empty state message
    And I see a "Create your first agent" call to action

  Scenario: Agents are project-scoped
    Given I am in project "Project A"
    And agent "Code Processor" exists in "Project A"
    And agent "Other Agent" exists in "Project B"
    When I navigate to the agents page
    Then I only see "Code Processor"
    And I do not see "Other Agent"

  # ============================================================================
  # Agent CRUD - Update
  # ============================================================================

  Scenario: Edit code-based agent
    Given agent "Python Processor" of type "code" exists
    When I click on agent "Python Processor"
    Then the AgentCodeEditorDrawer opens with existing code
    When I modify the python code
    And I click "Save"
    Then the agent is updated in the database
    And the updatedAt timestamp is refreshed

  Scenario: Edit workflow-based agent
    Given agent "Pipeline Agent" of type "workflow" exists
    When I click on agent "Pipeline Agent"
    Then the WorkflowSelectorDrawer opens with existing workflow selected
    When I select a different workflow
    And I click "Save"
    Then the agent is updated in the database

  # ============================================================================
  # Agent CRUD - Delete (soft delete)
  # ============================================================================

  Scenario: Archive agent
    Given agent "Old Agent" exists
    When I click the delete button for "Old Agent"
    And I confirm the deletion
    Then the agent is soft-deleted (archivedAt is set)
    And "Old Agent" no longer appears in the agents list

  Scenario: Archived agents are excluded from list
    Given agent "Active Agent" exists
    And agent "Archived Agent" was archived
    When I navigate to the agents page
    Then I see "Active Agent"
    And I do not see "Archived Agent"

  # ============================================================================
  # Agent config storage
  # ============================================================================

  Scenario: Code agent config stored as JSON
    Given I create a code-based agent with:
      | name | Python Processor           |
      | code | def execute(input): pass   |
    Then the agent record has type "code"
    And the config JSON contains the code configuration

  Scenario: Workflow agent has workflowId at top level
    Given I create a workflow-based agent referencing workflow "Pipeline"
    Then the agent record has type "workflow"
    And the workflowId field is set at the top level (not nested in config)
    And this allows efficient database joins on workflowId

  # ============================================================================
  # Agent selection drawer (for use in Evaluations V3)
  # ============================================================================

  Scenario: AgentListDrawer shows available agents
    Given agents "Code Processor" and "Pipeline Agent" exist
    When the AgentListDrawer opens
    Then I see both agents listed
    And I see a "New Agent" button at the top

  Scenario: AgentListDrawer empty state
    Given no agents exist
    When the AgentListDrawer opens
    Then I see "Create your first agent" message
    And I see a "New Agent" button

  Scenario: Select agent from drawer
    Given the AgentListDrawer is open
    And agent "Code Processor" exists
    When I click on "Code Processor"
    Then the drawer closes
    And "Code Processor" is selected for use

  Scenario: Create new agent from drawer flow
    Given the AgentListDrawer is open
    When I click "New Agent"
    Then the AgentTypeSelectorDrawer opens
    When I select "Code Agent"
    Then the AgentCodeEditorDrawer opens
    When I complete the agent configuration and save
    Then the new agent appears in the AgentListDrawer
    And I can select it

  # ============================================================================
  # Agent type selector drawer
  # ============================================================================

  Scenario: AgentTypeSelectorDrawer shows two options
    When the AgentTypeSelectorDrawer opens
    Then I see two options:
      | option         | icon     | description                    |
      | Code Agent     | code     | Create a Python code executor  |
      | Workflow Agent | workflow | Use an existing workflow       |

  Scenario: Selecting type navigates to appropriate editor
    Given the AgentTypeSelectorDrawer is open
    When I select "Code Agent"
    Then the AgentCodeEditorDrawer opens
    When I go back and select "Workflow Agent"
    Then the WorkflowSelectorDrawer opens

  # ============================================================================
  # Workflow selector drawer
  # ============================================================================

  Scenario: WorkflowSelectorDrawer lists project workflows
    Given workflows "Pipeline A" and "Pipeline B" exist in the project
    When the WorkflowSelectorDrawer opens
    Then I see both workflows listed
    And I see a "+ New Workflow" button at the top

  Scenario: WorkflowSelectorDrawer empty state
    Given no workflows exist in the project
    When the WorkflowSelectorDrawer opens
    Then I see "No workflows yet" message
    And I see a "+ New Workflow" button

  Scenario: New Workflow button navigates to workflows page
    Given the WorkflowSelectorDrawer is open
    When I click "+ New Workflow"
    Then I am navigated to /[project]/workflows page
