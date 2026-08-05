Feature: Langy conversation titles are derived, then generated once by a cheap model
  As a Langy user
  I want each conversation to get a short, meaningful title on its own
  So that my recent-chats list is scannable without me naming anything, while a
  title I set by hand is always respected

  # Behavioural contract for the conversation-title feature (ADR-046 follow-up).
  # The title is a first-class concern of the `langy_conversation` aggregate:
  #   - the first user message DERIVES a placeholder title,
  #   - a `GenerateConversationTitle` command emits `conversation_title_generated`,
  #     which the conversation process schedules after a finalized turn,
  #   - a manual rename (`conversation_metadata_updated` carrying a title) is
  #     sticky and an auto title never overrides it.
  # The operational state and conversation process track WHERE the current title
  # came from via `titleSource` (derived | auto | user), so a manual title wins.

  Background:
    Given I am signed in with Langy enabled for project "demo"

  # ============================================================================
  # A placeholder title, derived from the first message
  # ============================================================================

  Scenario: The first message derives a placeholder title
    Given no Langy conversation exists yet
    When I send the message "why are my traces failing since the deploy?"
    Then the conversation title is derived from the first message
    And the title source is recorded as derived

  Scenario: A message with no text leaves the title unset but still derived-eligible
    Given no Langy conversation exists yet
    When I send a message that carries no title text
    Then the conversation has no title yet
    And the title source is still open to an auto title

  # ============================================================================
  # One automatic title at the first successful turn boundary
  # ============================================================================

  Scenario: The first successful agent response generates a concise title
    Given a conversation whose title is still the first-message placeholder
    When the agent records its first successful response
    Then a cheap model is asked for a concise title of about sixty characters
    And a "conversation_title_generated" event is recorded with source auto
    And the conversation title becomes the generated title
    And the title source is recorded as auto

  Scenario: An automatic title is stable across later turns
    Given a conversation whose title was already auto-generated
    When the next agent turn is finalized
    Then no new title is generated for that turn
    And no message counter or timer schedules a fresh title

  Scenario: A failed turn does not trigger title generation
    Given a conversation with a placeholder title
    When the agent turn is finalized as failed
    Then no "conversation_title_generated" event is recorded

  Scenario: Replaying a successful response does not repeat title side effects
    Given a conversation whose title was generated after a successful response
    When that successful response event is replayed to rebuild projections
    Then the cheap title model is not called
    And no new "conversation_title_generated" event is recorded

  Scenario: Title generation never breaks the turn
    Given the cheap model is unavailable
    When the first successful turn would generate the title
    Then the title is left unchanged
    And the turn's outcome is unaffected

  # ============================================================================
  # A manual rename always wins
  # ============================================================================

  Scenario: An auto title never overrides a manual rename
    Given a conversation I renamed by hand
    When a later turn is finalized
    Then no "conversation_title_generated" event changes the title
    And the title source stays user

  Scenario: A manual rename sticks even after prior auto titles
    Given a conversation whose title was auto-generated
    When I rename the conversation by hand
    Then the title source becomes user
    And subsequent automatic generation is skipped

  # ============================================================================
  # The new title shows up live
  # ============================================================================

  Scenario: A generated title appears in the sidebar without a refresh
    Given I have the recent-chats list open
    When a conversation's first automatic title is generated
    Then the freshness broadcast signals that the title changed
    And the list re-reads the conversation so the new title appears
    And the title text itself is never put on the tenant-wide broadcast
