@unit
Feature: Prompt selection drawer
  As a user of LangWatch
  I want to select and manage prompts through a drawer interface
  So that I can easily use prompts in evaluations and other features

  # The PromptListDrawer provides a consistent way to select prompts
  # across the application, with folder grouping and create/edit capabilities.

  # ============================================================================
  # PromptListDrawer - Basic display
  # ============================================================================

  Scenario: PromptListDrawer shows list of prompts
    Given prompts "my-assistant", "code-reviewer", and "translator" exist
    When the PromptListDrawer opens
    Then I see all three prompts listed
    And I see a "+ New Prompt" button at the top

  Scenario: PromptListDrawer empty state
    Given no prompts exist in the project
    When the PromptListDrawer opens
    Then I see "No prompts yet" message
    And I see a "Create your first prompt" call to action
    And I see a "+ New Prompt" button

  Scenario: Each prompt shows relevant info
    Given prompt "my-assistant" exists with model "openai/gpt-4o"
    When the PromptListDrawer opens
    Then I see prompt "my-assistant" with:
      | field      | value           |
      | name       | my-assistant    |
      | model icon | OpenAI icon     |

  # ============================================================================
  # Folder grouping
  # ============================================================================

  Scenario: Prompts grouped by folder
    Given the following prompts exist:
      | handle                | folder  |
      | shared/ts-guidelines  | shared  |
      | shared/go-guidelines  | shared  |
      | local/my-prompt       | local   |
      | standalone-prompt     | default |
    When the PromptListDrawer opens
    Then I see folders "shared" and "local" as collapsible sections
    And prompts without folders appear in a default section
    And folder sections are collapsed by default

  Scenario: Expand folder to see prompts
    Given prompt "shared/ts-guidelines" exists in folder "shared"
    When the PromptListDrawer opens
    And I click on folder "shared" to expand it
    Then I see prompt "ts-guidelines" inside the folder

  Scenario: Folder display shows prompt count
    Given folder "shared" contains 3 prompts
    When the PromptListDrawer opens
    Then folder "shared" shows "(3)" next to its name

  # ============================================================================
  # Prompt selection
  # ============================================================================

  Scenario: Select prompt from list
    Given the PromptListDrawer is open
    And prompt "my-assistant" exists
    When I click on prompt "my-assistant"
    Then the drawer closes
    And "my-assistant" is selected for use

  Scenario: Select prompt from folder
    Given the PromptListDrawer is open
    And prompt "shared/ts-guidelines" exists
    When I expand folder "shared"
    And I click on prompt "ts-guidelines"
    Then the drawer closes
    And "shared/ts-guidelines" is selected

  Scenario: Selection callback receives prompt data
    Given the PromptListDrawer is open with onSelect callback
    When I select prompt "my-assistant"
    Then the onSelect callback receives:
      | field     | value        |
      | id        | prompt-id    |
      | name      | my-assistant |
      | versionId | version-id   |

  # ============================================================================
  # Create new prompt flow
  # ============================================================================

  Scenario: New Prompt button opens editor drawer
    Given the PromptListDrawer is open
    When I click "+ New Prompt"
    Then the PromptEditorDrawer opens
    And the PromptListDrawer remains in the drawer stack

  Scenario: Create new prompt and select it
    Given the PromptListDrawer is open
    When I click "+ New Prompt"
    And I configure a new prompt with:
      | field  | value                       |
      | name   | new-test-prompt             |
      | model  | openai/gpt-4o               |
      | prompt | You are a helpful assistant |
    And I click "Save"
    Then the prompt is saved to the Prompts system
    And the PromptListDrawer reopens
    And "new-test-prompt" is automatically selected

  Scenario: Cancel new prompt returns to list
    Given the PromptEditorDrawer is open from PromptListDrawer
    When I click "Cancel" or the back button
    Then I return to the PromptListDrawer
    And no prompt is selected

  # ============================================================================
  # PromptEditorDrawer - Create mode
  # ============================================================================

  Scenario: PromptEditorDrawer create mode shows empty form
    When the PromptEditorDrawer opens in create mode
    Then I see an empty prompt configuration form
    And the title is "New Prompt"
    And I see fields for:
      | field    | type     |
      | Name     | text     |
      | Model    | selector |
      | Messages | editor   |
      | Inputs   | list     |
      | Outputs  | list     |

  Scenario: Save new prompt
    Given the PromptEditorDrawer is open in create mode
    When I enter name "test-prompt"
    And I select model "openai/gpt-4o"
    And I add a system message "You are helpful"
    And I click "Save"
    Then the prompt is saved with version 1
    And the drawer closes

  Scenario: Validation prevents saving without name
    Given the PromptEditorDrawer is open in create mode
    When I leave the name field empty
    And I try to save
    Then I see a validation error for the name field
    And the prompt is not saved

  # ============================================================================
  # PromptEditorDrawer - Edit mode
  # ============================================================================

  Scenario: PromptEditorDrawer edit mode shows existing config
    Given prompt "my-assistant" exists with:
      | field   | value                       |
      | model   | openai/gpt-4o               |
      | prompt  | You are a helpful assistant |
      | inputs  | question, context           |
      | outputs | answer                      |
    When the PromptEditorDrawer opens for "my-assistant"
    Then I see the existing configuration
    And the title is "Edit Prompt"
    And I see the system prompt "You are a helpful assistant"
    And I see inputs "question" and "context"
    And I see output "answer"

  Scenario: Edit and save prompt creates new version
    Given the PromptEditorDrawer is open for prompt "my-assistant" version 2
    When I modify the system message
    And I click "Save"
    Then a new version 3 is created
    And the previous version remains unchanged

  Scenario: Discard changes warning
    Given the PromptEditorDrawer is open with unsaved changes
    When I click the close button
    Then I see a confirmation dialog
    And I can choose to discard changes or continue editing

  # ============================================================================
  # Navigation and drawer stack
  # ============================================================================

  Scenario: Back button returns to previous drawer
    Given the PromptEditorDrawer was opened from PromptListDrawer
    Then the back button is visible
    When I click the back button
    Then I return to the PromptListDrawer

  Scenario: No back button when opened directly
    When the PromptEditorDrawer is opened directly (not from list)
    Then no back button is visible
    And closing the drawer exits the flow

  Scenario: Drawer stack maintains history
    Given I open PromptListDrawer
    And I click "+ New Prompt" to open PromptEditorDrawer
    When I click back
    Then I return to PromptListDrawer
    When I close the drawer
    Then all drawers are closed

  # ============================================================================
  # Search and filter
  # ============================================================================

  Scenario: Search prompts by name
    Given prompts "assistant", "reviewer", and "translator" exist
    When I type "assist" in the search field
    Then only "assistant" is shown in the list

  Scenario: Search shows no results message when no matches
    Given prompts "assistant" and "reviewer" exist
    When I type "nonexistent" in the search field
    Then I see "No prompts match" message
    And I see a "Clear search" button

  @future
  Scenario: Filter prompts by model
    Given prompts exist with different models
    When I filter by model "openai/gpt-4o"
    Then only prompts using that model are shown
