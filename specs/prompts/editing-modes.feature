Feature: Prompt/Messages Editing Modes
  As a user editing prompts
  I want to switch between simple Prompt mode and detailed Messages mode
  So that I can use a simplified view for basic prompts or full control when needed

  Background:
    Given I have a prompt with:
      | system message    | You are a helpful assistant. |
      | user message      | {{input}}                    |
      | assistant message | (none)                       |

  # Prompt Mode (Default)
  Scenario: Default editing mode is Prompt mode
    When I open the prompt editor
    Then the editing mode is "Prompt"
    And I see the label "Prompt" (not "System Prompt")
    And I see a single textarea with the system prompt content
    And I do not see the user message
    And I do not see the +/- message buttons
    And I do not see role labels

  Scenario: Editing system prompt in Prompt mode
    Given the editing mode is "Prompt"
    When I type "You are a code reviewer." in the prompt textarea
    Then the system message content is updated to "You are a code reviewer."
    And the user message remains "{{input}}" (preserved but hidden)

  Scenario: Adding variables in Prompt mode still works
    Given the editing mode is "Prompt"
    When I type "{{context}}" in the prompt textarea
    Then a new "context" variable is created
    And the variable appears in the Variables section

  # Messages Mode
  Scenario: Switching to Messages mode
    Given the editing mode is "Prompt"
    When I click on "Messages" in the mode toggle
    Then the editing mode changes to "Messages"
    And I see the system message with "SYSTEM" label
    And I see the user message with "USER" label containing "{{input}}"
    And I see the +/- buttons for adding/removing messages

  Scenario: Adding a new user message in Messages mode
    Given the editing mode is "Messages"
    When I click the + button and select "User"
    Then a new empty user message is added
    And I can type content in the new message

  Scenario: Adding a new assistant message in Messages mode
    Given the editing mode is "Messages"
    When I click the + button and select "Assistant"
    Then a new empty assistant message is added

  Scenario: Removing a message in Messages mode
    Given the editing mode is "Messages"
    And there are 3 messages (system, user, assistant)
    When I click the remove button on the assistant message
    Then the assistant message is removed
    And only system and user messages remain

  # Mode Switching Preserves Content
  Scenario: Switching from Messages to Prompt mode preserves all messages
    Given the editing mode is "Messages"
    And I have added an assistant message with content "I understand."
    When I switch to "Prompt" mode
    Then the assistant message is hidden but preserved
    And when I switch back to "Messages" mode
    Then the assistant message is still there with content "I understand."

  Scenario: Complex conversation preserved when switching modes
    Given the editing mode is "Messages"
    And I have the following messages:
      | role      | content                        |
      | system    | You are helpful.               |
      | user      | {{question}}                   |
      | assistant | Let me help.                   |
      | user      | {{followup}}                   |
    When I switch to "Prompt" mode
    And I switch back to "Messages" mode
    Then all 4 messages are still present with their original content

  # Edge Cases
  Scenario: No system message when switching to Prompt mode
    Given the prompt has no system message
    When I switch to "Prompt" mode
    Then a system message is created with empty content
    And I can start typing in the prompt textarea

  Scenario: Mode toggle is visible in both drawer and playground
    When I open the prompt editor in the drawer
    Then I see the Prompt/Messages toggle
    When I open the prompt editor in the Playground
    Then I see the Prompt/Messages toggle
