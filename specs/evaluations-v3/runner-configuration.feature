@unit
Feature: Runner configuration
  As a user configuring an evaluation
  I want to add and configure runners (Prompts or Agents)
  So that I can compare different prompts, models, and code implementations

  # Runners are the unified concept for things that can be evaluated.
  # A runner can be either:
  # - A Prompt (versioned prompt from the Prompts system)
  # - An Agent (code executor or workflow)

  Background:
    Given I render the EvaluationsV3 spreadsheet table

  # ============================================================================
  # Header and button display
  # ============================================================================

  Scenario: Super header displays "Prompts or Agents"
    Then the super header column displays "Prompts or Agents"

  Scenario: Show required indicator when no runners configured
    Given no runners are configured
    Then the "+ Add" button displays a warning indicator

  Scenario: Button text changes based on runner count
    Given no runners are configured
    Then I see a "+ Add" button
    When I add a runner
    Then the button text changes to "+ Add Comparison"

  # ============================================================================
  # Runner type selection flow
  # ============================================================================

  Scenario: Click Add opens runner type selector
    When I click the "+ Add" button
    Then the RunnerTypeSelectorDrawer opens
    And I see two options: "Prompt" and "Agent"

  Scenario: Select Prompt type opens prompt list
    Given the RunnerTypeSelectorDrawer is open
    When I select "Prompt"
    Then the PromptListDrawer opens
    And I can select from existing prompts

  Scenario: Select Agent type opens agent list
    Given the RunnerTypeSelectorDrawer is open
    When I select "Agent"
    Then the AgentListDrawer opens
    And I can select from existing agents (code or workflow only)

  # ============================================================================
  # Adding prompts as runners
  # ============================================================================

  Scenario: Add existing prompt as runner
    Given prompt "my-assistant" exists with version 3
    When I click "+ Add"
    And I select "Prompt"
    And I select prompt "my-assistant"
    Then a new runner column appears in the table
    And the runner header shows the prompt name and model icon
    And the runner type is "prompt"

  Scenario: Add prompt from folder
    Given prompt "shared/ts-guidelines" exists in folder "shared"
    When I click "+ Add"
    And I select "Prompt"
    Then I see prompts grouped by folder
    When I expand folder "shared"
    And I select prompt "ts-guidelines"
    Then the runner is added with name "ts-guidelines"

  Scenario: Create new prompt inline
    When I click "+ Add"
    And I select "Prompt"
    And I click "+ New Prompt" in the PromptListDrawer
    Then the PromptEditorDrawer opens
    When I configure a new prompt with name "test-prompt"
    And I save the prompt
    Then the prompt is saved to the Prompts system
    And the runner is added to the evaluation

  # ============================================================================
  # Adding agents as runners
  # ============================================================================

  Scenario: Add existing code agent as runner
    Given agent "Python Processor" of type "code" exists
    When I click "+ Add"
    And I select "Agent"
    And I select agent "Python Processor"
    Then a new runner column appears in the table
    And the runner header shows a code icon
    And the runner type is "agent"

  Scenario: Add existing workflow agent as runner
    Given agent "Pipeline Agent" of type "workflow" exists
    When I click "+ Add"
    And I select "Agent"
    And I select agent "Pipeline Agent"
    Then a new runner column appears in the table
    And the runner header shows a workflow icon

  Scenario: Create new code agent inline
    When I click "+ Add"
    And I select "Agent"
    And I click "New Agent"
    And I select "Code Agent" type
    Then the AgentCodeEditorDrawer opens
    When I configure and save the agent
    Then the agent is saved to the database
    And the runner is added to the evaluation

  # ============================================================================
  # Comparison flow
  # ============================================================================

  Scenario: Add multiple runners for comparison
    Given a prompt runner "my-assistant" is configured
    When I click "+ Add Comparison"
    And I select "Agent"
    And I add agent "Python Processor"
    Then 2 runner columns are visible in the table
    And I can compare prompt vs agent outputs

  Scenario: Compare two prompts
    Given prompt "prompt-v1" exists
    And prompt "prompt-v2" exists
    When I add prompt "prompt-v1" as a runner
    And I click "+ Add Comparison"
    And I add prompt "prompt-v2" as a runner
    Then 2 runner columns show the different prompts
    And I can compare their outputs side by side

  Scenario: Compare prompt with code agent
    Given prompt "my-assistant" exists
    And agent "Custom Logic" of type "code" exists
    When I add prompt "my-assistant" as a runner
    And I click "+ Add Comparison"
    And I add agent "Custom Logic" as a runner
    Then I can compare LLM output vs custom code output

  # ============================================================================
  # Runner header interactions
  # ============================================================================

  Scenario: Runner header shows popover on click
    Given a prompt runner "my-assistant" is configured
    When I click on the runner header "my-assistant"
    Then a popover menu appears with options:
      | Edit Prompt          |
      | Remove from Workbench|

  Scenario: Runner header shows play button
    Given a prompt runner "my-assistant" is configured
    Then the runner header shows a play button on the far right
    # Note: Play button functionality to be implemented later

  Scenario: Edit prompt from header popover
    Given a prompt runner "my-assistant" is configured
    When I click on the runner header "my-assistant"
    And I click "Edit Prompt" in the popover
    Then the PromptEditorDrawer opens with the prompt loaded
    And I see the prompt's system prompt content
    And I see the prompt's inputs section
    And I see the prompt's outputs section

  Scenario: Remove runner from workbench
    Given a prompt runner "my-assistant" is configured
    When I click on the runner header "my-assistant"
    And I click "Remove from Workbench" in the popover
    Then the runner column is removed from the table

  Scenario: Agent header popover shows Edit Agent
    Given an agent runner "Python Processor" is configured
    When I click on the runner header "Python Processor"
    Then a popover menu appears with options:
      | Edit Agent           |
      | Remove from Workbench|

  Scenario: Edit code agent from header popover
    Given an agent runner "Python Processor" of type "code" exists in the database
    When I click on the runner header "Python Processor"
    And I click "Edit Agent" in the popover
    Then the system fetches the agent data via tRPC
    And the AgentCodeEditorDrawer opens

  Scenario: Edit workflow agent opens in new tab
    Given an agent runner "Pipeline Agent" of type "workflow" exists in the database
    When I click on the runner header "Pipeline Agent"
    And I click "Edit Agent" in the popover
    Then the system fetches the agent data via tRPC
    And the workflow opens in a new browser tab

  # ============================================================================
  # Runner configuration and mapping
  # ============================================================================

  Scenario: Edit existing runner configuration
    Given a prompt runner "my-assistant" is configured
    When I click on the runner header "my-assistant"
    And I click "Edit Prompt" in the popover
    Then the PromptEditorDrawer opens with the current config
    And I can modify the prompt and save changes

  Scenario: Runner with unmapped required inputs shows warning
    Given a runner with input "userQuestion" is configured
    And the dataset has column "input"
    And "userQuestion" is not mapped to any dataset column
    Then the runner column header shows a warning indicator

  Scenario: Map runner input to dataset column
    Given a runner with input "userQuestion" is configured
    And the dataset has column "input"
    When I open the runner configuration panel
    And I map "userQuestion" to dataset column "input"
    Then the warning indicator disappears from the runner header

  # ============================================================================
  # UI interactions
  # ============================================================================

  Scenario: Interact with table while drawer is open
    When I click the "+ Add" button
    And the RunnerTypeSelectorDrawer is open
    Then I can still click and edit cells in the table
    And I can scroll the table

  Scenario: Close drawer by clicking X button
    When I click the "+ Add" button
    And I click the close button on the drawer
    Then the RunnerTypeSelectorDrawer closes

  Scenario: Navigate back in drawer flow
    When I click "+ Add"
    And I select "Prompt"
    Then the PromptListDrawer opens with a back button
    When I click the back button
    Then I return to the RunnerTypeSelectorDrawer
