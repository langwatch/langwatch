@unimplemented
Feature: Langy post-turn inline suggestions
  As a user of LangWatch
  I want Langy to suggest a useful next step after answering my question
  So that I am nudged toward valuable actions without losing momentum

  # See specs/assistant/PRD.md §7.
  # Suggestions are produced INLINE by the chat agent at the end of each
  # assistant turn. There is no separate cron worker. The agent emits zero or
  # one structured "next step" block alongside its response.

  Background:
    Given I am authenticated
    And I have access to project "demo"

  # ============================================================================
  # Production rules
  # ============================================================================

  Scenario: Langy emits at most one suggestion per turn
    When I send a message and Langy responds
    Then the response contains zero or one suggestion
    And it never contains two or more

  Scenario: Suggestion is part of the same turn, not a follow-up
    When Langy responds with a suggestion
    Then the suggestion arrives in the same streamed response as the answer
    And no second LLM call is made to produce it

  # ============================================================================
  # Display rules
  # ============================================================================

  Scenario: Suggestion renders as a dismissible chip below the assistant message
    Given Langy emitted a suggestion
    Then the chip is visible beneath the assistant message
    And the chip shows a label and a short rationale

  Scenario: Click suggestion to act
    Given a suggestion of kind "open_proposal" is visible
    When I click it
    Then the relevant proposal flow opens
    And no mutation has occurred yet

  Scenario: Click suggestion of kind open_url
    Given a suggestion of kind "open_url" is visible
    When I click it
    Then I am navigated to the suggested page in the same project

  Scenario: Click suggestion of kind ask_followup
    Given a suggestion of kind "ask_followup" is visible
    When I click it
    Then the suggested follow-up question is sent as my next message

  Scenario: Dismiss a suggestion
    Given a suggestion is visible
    When I click "Dismiss"
    Then the chip is hidden
    And the assistant message remains

  Scenario: "Don't show this kind again"
    Given a suggestion of kind "rerun-stale-experiment" is visible
    When I click "Don't show this kind again"
    Then the kind is appended to my LangyUserPreferences.dismissedSuggestionKinds
    And no future turn produces a suggestion of this kind for me in this project
    Until I re-enable it from settings

  # ============================================================================
  # Suppression rules (when Langy SHOULD NOT suggest anything)
  # ============================================================================

  Scenario: No suggestion when the previous turn applied a proposal
    Given my previous turn applied a proposal
    When I send a follow-up message
    Then Langy's response contains no suggestion
    # Reason: avoid suggestion fatigue immediately after the user just acted.

  Scenario: No suggestion when actively troubleshooting
    Given the conversation contains a stack trace or explicit error from the user
    When Langy responds
    Then no suggestion is emitted
    # Reason: don't interrupt diagnosis with a nudge.

  Scenario: User asks Langy to stop suggesting
    When I tell Langy "stop suggesting things"
    Then no further suggestions are emitted in this conversation
    And this preference persists for the remainder of the conversation

  Scenario: Dismissed kinds do not reappear
    Given I have dismissed kind "rerun-stale-experiment"
    When Langy would otherwise emit a suggestion of that kind
    Then it emits no suggestion in that turn

  # ============================================================================
  # Privacy and safety
  # ============================================================================

  Scenario: Suggestions never auto-apply
    Given any suggestion is visible
    Then no mutation has occurred
    And clicking the suggestion opens a flow that requires explicit user action

  Scenario: Suggestions never reference data from another project
    Given I am working in project "demo"
    Then no suggestion references entities from project "other"

  Scenario: Suggestions never reference another user's private conversation
    Given another user "bob" has a private conversation in project "demo"
    Then no suggestion in my conversation references content from bob's chat
