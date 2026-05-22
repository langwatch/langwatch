@unimplemented
Feature: Langy memory
  As a user of LangWatch
  I want Langy to remember relevant context across conversations
  So that I do not have to re-explain my project every time I open it

  # See specs/assistant/PRD.md §6 for the memory tier model.
  # In-scope here: L3 (cross-session conversation history) and L4 (project memory file).
  # Out of scope: L5 (episodic auto-extracted facts).

  Background:
    Given I am authenticated as "alice@example.com"
    And I have access to project "demo"

  # ============================================================================
  # L3 — cross-session conversation history
  # ============================================================================

  Scenario: Conversation history persists across page reloads
    Given I have an open Langy conversation with 5 messages
    When I reload the page
    Then the same conversation reopens with all 5 messages

  Scenario: Start a new conversation
    Given I have an existing Langy conversation
    When I click "New chat"
    Then a fresh conversation is opened with no prior messages
    And the previous conversation remains in my recent list

  Scenario: View recent conversations
    Given I have 3 prior Langy conversations in project "demo"
    When I open the recent list
    Then I see the 3 conversations ordered by last activity

  Scenario: Conversation history is scoped per user within a project
    Given user "bob@example.com" has Langy conversations in project "demo"
    And I am authenticated as "alice@example.com" in project "demo"
    When I open my recent list
    Then I see only my own conversations
    And Bob's conversations are not visible

  Scenario: Conversation history never crosses projects
    Given I have Langy conversations in project "demo"
    When I switch to project "other"
    Then my "demo" conversations are not visible in "other"

  Scenario: Delete a conversation
    Given I have a Langy conversation
    When I delete it
    Then it no longer appears in my recent list
    And its messages are no longer used as context for future conversations

  Scenario: Idle conversations are hard-deleted after 90 days
    Given a conversation has had no activity for 91 days
    When the retention sweep runs
    Then the conversation and its messages are permanently removed

  # ============================================================================
  # L4 — project memory file
  # ============================================================================

  Scenario: First-time project memory init
    Given project "demo" has no Langy project memory
    When I open Langy for the first time in "demo"
    Then Langy offers to initialize project memory
    When I accept and answer the onboarding questions
    Then a project memory file is created
    And it summarizes the project's evaluators, prompts, and main concerns

  Scenario: Project memory is injected into every conversation
    Given project "demo" has a project memory file
    When I send a new message in any Langy conversation in "demo"
    Then the project memory is included in the system context
    And Langy answers consistently with that memory

  Scenario: Edit project memory
    Given project "demo" has a project memory file
    When I open the project memory settings page
    Then I can read and edit the memory text
    When I save my edits
    Then subsequent conversations use the edited memory

  Scenario: Stale project memory prompts a refresh
    Given project "demo"'s memory file is older than 30 days
    When I open Langy
    Then a non-blocking banner offers to refresh project memory

  Scenario: Project memory token budget is enforced
    Given project "demo"'s memory file would exceed 2k tokens
    When the memory is injected
    Then it is summarized to fit the 2k cap
    And the user can see the summarized version

  Scenario: Project memory does not cross project boundaries
    Given project "demo" has a project memory file
    When I open Langy in project "other"
    Then "demo"'s memory is not used

  # ============================================================================
  # Privacy controls
  # ============================================================================

  Scenario: View what Langy remembers about me in this project
    When I open the Langy memory settings page
    Then I see my conversation history
    And I see the project memory file
    And I have one-click delete for each

  Scenario: Clear all my memory in this project
    Given I have conversations and contributed to the project memory
    When I click "Clear my Langy memory"
    Then my conversations are deleted
    And my contributions to project memory are removed
    And the project memory file remains for other users

  # ============================================================================
  # Lazy semantic retrieval (L6)
  # ============================================================================

  Scenario: Langy retrieves traces via tool, not pre-injection
    When I ask Langy "find traces with hallucinations"
    Then Langy calls the search_traces tool
    And the tool result is included only for that turn
    And the system prompt does not pre-include trace data
