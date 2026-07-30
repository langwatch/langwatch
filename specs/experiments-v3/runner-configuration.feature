@unit
Feature: Runner configuration
  As a user configuring an evaluation
  I want to add and configure runners (Prompts or Agents)
  So that I can compare different prompts, models, and code implementations

  # Runners are the unified concept for things that can be evaluated.
  # A runner can be either:
  # - A Prompt (versioned prompt from the Prompts system)
  # - An Agent (code executor or workflow)

  # ===========================================================================
  # What "bound" means in this file
  # ===========================================================================
  # The bound runner-header scenarios are pinned by unit tests over TargetHeader
  # (experiments-v3/components/TargetSection/__tests__/TargetHeader.test.tsx).
  # Those tests observe the header seam: which items the menu offers, and that
  # choosing one raises that action for exactly this runner. What the workbench
  # then does with the action — a column appearing, a column disappearing, the
  # editor drawer's contents — belongs to the store and the drawer, and stays
  # @unimplemented here rather than being pinned to a test that never observes
  # it. A navigation assertion is not an outcome assertion.

  Background:
    Given I render the EvaluationsV3 spreadsheet table

  # ============================================================================
  # Header and button display
  # ============================================================================

  @unimplemented
  Scenario: Super header displays "Prompts or Agents"
    Then the super header column displays "Prompts or Agents"

  @unimplemented
  Scenario: Show required indicator when no runners configured
    Given no runners are configured
    Then the "+ Add" button displays a warning indicator

  @unimplemented
  Scenario: Button text changes based on runner count
    Given no runners are configured
    Then I see a "+ Add" button
    When I add a runner
    Then the button text changes to "+ Add Comparison"

  # ============================================================================
  # Runner type selection flow
  # ============================================================================

  @unimplemented
  Scenario: Click Add opens runner type selector
    When I click the "+ Add" button
    Then the RunnerTypeSelectorDrawer opens
    And I see two options: "Prompt" and "Agent"

  @unimplemented
  Scenario: Select Prompt type opens prompt list
    Given the RunnerTypeSelectorDrawer is open
    When I select "Prompt"
    Then the PromptListDrawer opens
    And I can select from existing prompts

  @unimplemented
  Scenario: Select Agent type opens agent list
    Given the RunnerTypeSelectorDrawer is open
    When I select "Agent"
    Then the AgentListDrawer opens
    And I can select from existing agents (code or workflow only)

  # ============================================================================
  # Adding prompts as runners
  # ============================================================================

  @unimplemented
  Scenario: Add existing prompt as runner
    Given prompt "my-assistant" exists with version 3
    When I click "+ Add"
    And I select "Prompt"
    And I select prompt "my-assistant"
    Then a new runner column appears in the table
    And the runner header shows the prompt name and model icon
    And the runner type is "prompt"

  @unimplemented
  Scenario: Add prompt from folder
    Given prompt "shared/ts-guidelines" exists in folder "shared"
    When I click "+ Add"
    And I select "Prompt"
    Then I see prompts grouped by folder
    When I expand folder "shared"
    And I select prompt "ts-guidelines"
    Then the runner is added with name "ts-guidelines"

  @unimplemented
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

  @unimplemented
  Scenario: Add existing code agent as runner
    Given agent "Python Processor" of type "code" exists
    When I click "+ Add"
    And I select "Agent"
    And I select agent "Python Processor"
    Then a new runner column appears in the table
    And the runner header shows a code icon
    And the runner type is "agent"

  @unimplemented
  Scenario: Add existing workflow agent as runner
    Given agent "Pipeline Agent" of type "workflow" exists
    When I click "+ Add"
    And I select "Agent"
    And I select agent "Pipeline Agent"
    Then a new runner column appears in the table
    And the runner header shows a workflow icon

  @unimplemented
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

  @unimplemented
  Scenario: Add multiple runners for comparison
    Given a prompt runner "my-assistant" is configured
    When I click "+ Add Comparison"
    And I select "Agent"
    And I add agent "Python Processor"
    Then 2 runner columns are visible in the table
    And I can compare prompt vs agent outputs

  @unimplemented
  Scenario: Compare two prompts
    Given prompt "prompt-v1" exists
    And prompt "prompt-v2" exists
    When I add prompt "prompt-v1" as a runner
    And I click "+ Add Comparison"
    And I add prompt "prompt-v2" as a runner
    Then 2 runner columns show the different prompts
    And I can compare their outputs side by side

  @unimplemented
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

  @unit
  Scenario: Runner header shows a menu on click
    Given a prompt runner "my-assistant" is configured
    When I click on the runner header "my-assistant"
    Then a menu appears with options:
      | Edit Prompt          |
      | Duplicate            |
      | Switch Prompt        |
      | Remove from Workbench|

  # The play button is the last item in the header row, after a spacer, so it
  # sits hard right. Its column-shrink behaviour is what the tests pin: on a
  # narrow viewport everything else absorbs the squeeze so the button stays.
  @unit
  Scenario: Runner header shows play button
    Given a prompt runner "my-assistant" is configured
    Then the runner header shows a play button
    And the play button never shrinks out of its column

  @unit
  Scenario: Edit prompt from the runner header menu
    Given a prompt runner "my-assistant" is configured
    When I click on the runner header "my-assistant"
    And I click "Edit Prompt" in the menu
    Then the prompt editor is opened for that runner

  @unimplemented
  Scenario: Prompt editor shows the runner's prompt content
    Given a prompt runner "my-assistant" is configured
    When I open it with "Edit Prompt"
    Then I see the prompt's system prompt content
    And I see the prompt's inputs section
    And I see the prompt's outputs section

  @unit
  Scenario: Remove runner from workbench
    Given a prompt runner "my-assistant" is configured
    When I click on the runner header "my-assistant"
    And I click "Remove from Workbench" in the menu
    Then that runner is removed from the workbench

  @unit
  Scenario: Agent header menu shows Edit Agent
    Given an agent runner "Python Processor" is configured
    When I click on the runner header "Python Processor"
    Then a menu appears with options:
      | Edit Agent           |
      | Switch Agent         |
      | Remove from Workbench|

  @unimplemented
  Scenario: Edit code agent from header popover
    Given an agent runner "Python Processor" of type "code" exists in the database
    When I click on the runner header "Python Processor"
    And I click "Edit Agent" in the popover
    Then the system fetches the agent data via tRPC
    And the AgentCodeEditorDrawer opens

  @unimplemented
  Scenario: Edit workflow agent opens in new tab
    Given an agent runner "Pipeline Agent" of type "workflow" exists in the database
    When I click on the runner header "Pipeline Agent"
    And I click "Edit Agent" in the popover
    Then the system fetches the agent data via tRPC
    And the workflow opens in a new browser tab

  # ============================================================================
  # Runner configuration and mapping
  # ============================================================================

  @unimplemented
  Scenario: Edit existing runner configuration
    Given a prompt runner "my-assistant" is configured
    When I click on the runner header "my-assistant"
    And I click "Edit Prompt" in the popover
    Then the PromptEditorDrawer opens with the current config
    And I can modify the prompt and save changes

  @unimplemented
  Scenario: Runner with unmapped required inputs shows warning
    Given a runner with input "userQuestion" is configured
    And the dataset has column "input"
    And "userQuestion" is not mapped to any dataset column
    Then the runner column header shows a warning indicator

  @unimplemented
  Scenario: Map runner input to dataset column
    Given a runner with input "userQuestion" is configured
    And the dataset has column "input"
    When I open the runner configuration panel
    And I map "userQuestion" to dataset column "input"
    Then the warning indicator disappears from the runner header

  # ============================================================================
  # UI interactions
  # ============================================================================

  @unimplemented
  Scenario: Interact with table while drawer is open
    When I click the "+ Add" button
    And the RunnerTypeSelectorDrawer is open
    Then I can still click and edit cells in the table
    And I can scroll the table

  @unimplemented
  Scenario: Close drawer by clicking X button
    When I click the "+ Add" button
    And I click the close button on the drawer
    Then the RunnerTypeSelectorDrawer closes

  @unimplemented
  Scenario: Navigate back in drawer flow
    When I click "+ Add"
    And I select "Prompt"
    Then the PromptListDrawer opens with a back button
    When I click the back button
    Then I return to the RunnerTypeSelectorDrawer

  # ============================================================================
  # Unpublished prompt modifications (local tinkering)
  # ============================================================================

  @unimplemented
  Scenario: Edit prompt and close without saving persists local changes
    Given a prompt runner "my-assistant" is configured
    When I click on the runner header "my-assistant"
    And I click "Edit Prompt" in the menu
    And I modify the system message to "You are a modified assistant"
    And I close the drawer without clicking Save
    Then the local modifications are preserved in the runner config
    And no new version is published to the Prompts system

  @unit
  Scenario: Runner header shows orange dot for unpublished modifications
    Given a prompt runner "my-assistant" is configured
    And the runner has unpublished local modifications
    Then the runner header shows an orange dot next to the name

  # Hover-reveal only: the tooltip is a Chakra Tooltip that never opens under
  # jsdom, so this needs a real browser rather than a pretend unit binding.
  @e2e @unimplemented
  Scenario: Hovering the unpublished dot explains what it means
    Given a prompt runner "my-assistant" has unpublished modifications
    When I hover the orange dot on the runner header
    Then a tooltip reads "Unpublished modifications"

  @unimplemented
  Scenario: Orange dot disappears after publishing
    Given a prompt runner "my-assistant" has unpublished modifications
    When I click "Edit Prompt" in the menu
    And I click "Save" to publish the changes
    Then the orange dot disappears from the runner header
    And a new version is created in the Prompts system

  @unimplemented
  Scenario: Run evaluation with unpublished modifications
    Given a prompt runner "my-assistant" has unpublished modifications
    When I run the evaluation
    Then the evaluation uses the unpublished local configuration
    And the published version remains unchanged

  # ===========================================================================
  # Prompt editor drawer: model-only header, actions in the footer
  # ===========================================================================
  # This scenario used to read "PromptEditorDrawer header matches prompt
  # playground" and assert Save and version history in the drawer HEADER with
  # no save button in the footer. That was true when it was written (2025-12-29,
  # #1032, 2758a0a938) and stopped being true on 2026-02-15, when #1589
  # (3da4f982d5) moved them on purpose: "Move save/history/API buttons to footer
  # in drawer mode, keep model-only header", alongside "Add PromptEditorFooter
  # component shared across eval-v3 and studio drawers". The drawer footer had
  # to match the workflow studio pattern — [Discard] [Spacer] [History] [API]
  # [Save] [Apply] — and Save belongs beside Apply, which the playground has no
  # equivalent of.
  #
  # The playground did not follow and was never meant to: PromptBrowserHeader
  # still renders PromptEditorHeader with the default variant="full", so its
  # Save, history, Deploy and API buttons stay in the header. The two surfaces
  # share the header COMPONENT and differ by variant deliberately. Three tests
  # pin the drawer's footer layout — do not re-litigate this from the old text.
  @unit
  Scenario: Prompt editor drawer keeps the model selector in the header and the actions in the footer
    Given a prompt runner "my-assistant" is configured
    When I click "Edit Prompt" in the menu
    Then the prompt editor drawer shows a header above the messages
    And the header contains only a model selector
    And the footer contains a version history button
    And the footer contains a Save/Saved button
    And there is exactly one save button

  @unimplemented
  Scenario: Save button shows "Saved" when no changes
    Given the PromptEditorDrawer is open for prompt "my-assistant"
    And no modifications have been made
    Then the Save button shows "Saved" and is disabled

  @unimplemented
  Scenario: Save button shows "Save" when changes exist
    Given the PromptEditorDrawer is open for prompt "my-assistant"
    When I modify any field (model, message, inputs, or outputs)
    Then the Save button shows "Save" and is enabled

  @unimplemented
  Scenario: Version history restore updates form
    Given the PromptEditorDrawer is open for prompt "my-assistant"
    When I click the version history button
    And I select a previous version to restore
    Then the form is updated with the restored version's content
    And the Save button shows "Save" (indicating unsaved changes)

  @unimplemented
  Scenario: Discard local changes from version history drawer
    Given the PromptEditorDrawer is open for prompt "my-assistant"
    And I have made unpublished modifications
    When I click the version history button
    Then I see a "Discard local changes" button below the current version badge
    When I click "Discard local changes"
    Then the form is reset to the last published version
    And the Save button shows "Saved"
    And the orange dot disappears from the runner header

  @unimplemented
  Scenario: Local config updates immediately on form change
    Given a prompt runner "my-assistant" is configured
    When I click "Edit Prompt" in the menu
    And I modify the system message
    Then the orange dot appears immediately on the runner header
    And I can run the evaluation with the modified config without closing the drawer

  @unimplemented
  Scenario: Orange dot disappears when changes are reverted
    Given a prompt runner "my-assistant" has unpublished modifications
    When I click "Edit Prompt" in the menu
    And I revert my changes to match the published version
    Then the orange dot disappears from the runner header
