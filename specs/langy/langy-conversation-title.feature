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

  @unit
  Scenario: A model failure is retried instead of losing the title
    Given the title model fails on a provider blip
    When the title is generated
    Then the failure is raised so the process outbox retries it
    And the turn's outcome is unaffected

  @unit
  Scenario: A project with no model for titles is not retried
    Given the project has no model configured for titles
    When the title is generated
    Then no title is produced and nothing is retried

  @unit
  Scenario: A conversation with nothing to read is not retried
    Given a conversation whose transcript holds no text
    When the title is generated
    Then no title is produced and nothing is retried

  # ============================================================================
  # One title style, wherever the title came from
  # ============================================================================

  # Recent chats showed three styles at once: "Instrument Traces With LangWatch",
  # "Instrument Traces with LangWatch" and the raw first message
  # "instrument my traces with langwatch". Every title, generated or derived,
  # goes through the same normaliser: sentence case, no trailing period, no
  # surrounding quotes, at most sixty characters.

  @unit
  Scenario: A title in title case is rewritten in sentence case
    Given the model answers with "Instrument Traces With LangWatch"
    When the title is generated
    Then the conversation title reads "Instrument traces with LangWatch"

  @unit
  Scenario: Product names and acronyms keep their own capitalisation
    Given the model answers with "Fix The GitHub API Token"
    When the title is generated
    Then the conversation title reads "Fix the GitHub API token"

  @unit
  Scenario: Quotes and a trailing period are removed from a title
    Given the model answers with a quoted title ending in a period
    When the title is generated
    Then the conversation title carries no quotes and no trailing period

  @unit
  Scenario: A title longer than sixty characters is cut on a word boundary
    Given the model answers with a title far longer than sixty characters
    When the title is generated
    Then the conversation title ends on a whole word within sixty characters

  @unit
  Scenario: The placeholder title follows the same rules as a generated one
    Given the first message reads "instrument my traces with langwatch"
    When the placeholder title is derived from it
    Then the conversation title reads "Instrument my traces with langwatch"
    And the placeholder title is capped at sixty characters too

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
