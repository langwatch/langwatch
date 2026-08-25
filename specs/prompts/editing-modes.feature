Feature: Instructions/Messages Editing Modes
  As a user editing prompts
  I want to switch between simple Instructions mode and detailed Messages mode
  So that I can use a simplified view for basic prompts or full control when needed

  Background:
    Given I have a prompt with:
      | system message    | You are a helpful assistant. |
      | user message      | {{input}}                    |
      | assistant message | (none)                       |

  # Instructions Mode (Default)
  Scenario: Default editing mode is Instructions mode
    When I open the prompt editor
    Then the editing mode is "Instructions"
    And I see the label "Instructions" (not "System Prompt")
    And I see a single textarea with the system prompt content
    And I do not see the user message
    And I do not see the +/- message buttons
    And I do not see role labels

  Scenario: Editing system prompt in Instructions mode
    Given the editing mode is "Instructions"
    When I type "You are a code reviewer." in the prompt textarea
    Then the system message content is updated to "You are a code reviewer."
    And the user message remains "{{input}}" (preserved but hidden)

  Scenario: Adding variables in Instructions mode still works
    Given the editing mode is "Instructions"
    When I type "{{context}}" in the prompt textarea
    Then a new "context" variable is created
    And the variable appears in the Variables section

  # Messages Mode
  Scenario: Switching to Messages mode
    Given the editing mode is "Instructions"
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

  # Adding a user message from Instructions mode
  @integration
  Scenario: Adding a user message from Instructions mode
    Given the editing mode is "Instructions"
    And the prompt already has a hidden user message
    When I click "Add user message"
    Then the editing mode changes to "Messages"
    And the user message that was already there is shown
    And no second user message is created

  @integration
  Scenario: Adding a user message when the prompt has none
    Given the editing mode is "Instructions"
    And the prompt has only a system message
    When I click "Add user message"
    Then an empty user message is created
    And the editing mode changes to "Messages"
    And the new user message is shown

  # The user message is not always the last one. Revealing whichever row
  # happens to be last would put the cursor in an assistant message.
  @integration
  Scenario: Adding a user message when an assistant message follows it
    Given the editing mode is "Instructions"
    And the prompt has a system, a user and an assistant message
    When I click "Add user message"
    Then the editing mode changes to "Messages"
    And the user message that was already there is the one revealed
    And no second user message is created

  # Mode Switching Preserves Content
  Scenario: Switching from Messages to Instructions mode preserves all messages
    Given the editing mode is "Messages"
    And I have added an assistant message with content "I understand."
    When I switch to "Instructions" mode
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
    When I switch to "Instructions" mode
    And I switch back to "Messages" mode
    Then all 4 messages are still present with their original content

  # Edge Cases
  Scenario: No system message when switching to Instructions mode
    Given the prompt has no system message
    When I switch to "Instructions" mode
    Then a system message is created with empty content
    And I can start typing in the prompt textarea

  Scenario: Mode toggle is visible in both drawer and playground
    When I open the prompt editor in the drawer
    Then I see the Instructions/Messages toggle
    When I open the prompt editor in the Playground
    Then I see the Instructions/Messages toggle

  @integration
  Scenario: The mode title reads as clickable without hovering
    When I open the prompt editor
    Then the "Instructions" section title shows a chevron-down icon
    And the chevron is visible before any hover
