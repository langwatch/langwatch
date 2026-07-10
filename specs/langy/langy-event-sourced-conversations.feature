Feature: Langy conversations are an event-sourced projection
  As the LangWatch platform
  I want a Langy conversation to be a projection of an append-only event stream
  So that the conversation row and its messages can never drift, retries are
  idempotent, and turns are ordered per conversation

  # Behavioural contract for ADR-043 (PR2 of the Langy event-sourcing stack).
  # The conversation aggregate is `langy_conversation`; aggregateId is the
  # conversationId and TenantId is the projectId. Writes are commands that emit
  # past-tense events; the conversation row (langy_conversations fold) and the
  # message rows (langy_messages map) are both derived. The streaming worker and
  # the reconcile reactor are PR3 — this spec pins only the model + read/write.

  Background:
    Given I am signed in with Langy enabled for project "demo"

  # ============================================================================
  # Sending a message (the user turn)
  # ============================================================================

  Scenario: Sending the first message creates the conversation from its events
    Given no Langy conversation exists yet
    When I send the message "why are my traces failing?"
    Then a "message_sent" event is recorded for a new conversation aggregate
    And the conversation fold shows me as the owner
    And the conversation title is derived from the first message
    And the message count is 1
    And a user message row is stored in langy_messages for that conversation

  Scenario: A message and its activity bump are one command, not two writes
    Given I am continuing an existing conversation I own
    When I send a message
    Then exactly one "SendMessage" command is dispatched
    And the message content and the conversation's activity bump come from the
      same "message_sent" event
    And there is no separate spine write that could desync from the message

  Scenario: Retrying the same send does not double-count
    Given a "SendMessage" command with a fixed idempotency key
    When the command is dispatched twice for the same message
    Then the conversation message count reflects a single message
    And langy_messages holds a single row for that message id

  # ============================================================================
  # The agent turn and its final answer
  # ============================================================================

  Scenario: Starting an agent turn records the turn on the fold
    Given I have sent a message on a conversation I own
    When the agent turn begins
    Then an "agent_turn_started" event is recorded
    And the conversation status reflects an in-progress turn

  Scenario: Streamed tokens are not events
    Given an agent turn is streaming its answer token by token
    When 500 tokens have streamed
    Then no per-token event is written to the event log
    And only meaningful transitions and heartbeats are recorded as events

  Scenario: The finalized turn carries the whole answer as the source of truth
    Given an agent turn has streamed to completion
    When the turn is reconciled
    Then a "turn_finalized" event is recorded carrying the full final answer
    And an assistant message row is stored in langy_messages from that event
    And the conversation message count includes the assistant message
    And the conversation status returns to idle

  Scenario: A failed turn is recorded without an assistant message loss
    Given an agent turn ended in failure
    When the turn is reconciled with a failure outcome
    Then a "turn_finalized" event records the failure
    And the conversation status reflects the failure

  # ============================================================================
  # Reading conversations (projections)
  # ============================================================================

  Scenario: Listing conversations reads the fold, newest activity first
    Given I own three conversations with different last-activity times
    When I list my conversations
    Then they are returned ordered by last activity, newest first
    And each item exposes title, message count, and last activity
    And no archived conversation is included

  Scenario: A shared conversation is visible to other project members
    Given another member shared a conversation in "demo"
    When I list my conversations
    Then the shared conversation appears in my list
    And it is marked as not owned by me

  Scenario: Every conversation read is scoped to the tenant
    When any conversation or message is read from ClickHouse
    Then the query filters on TenantId first
    And no row from another project can be returned

  Scenario: Restoring a conversation returns its messages in order
    Given a conversation I own with a user message and an assistant reply
    When I open that conversation
    Then its messages are returned in send order
    And each message exposes its role and flattened text content

  # ============================================================================
  # Deleting becomes archiving
  # ============================================================================

  Scenario: Deleting a conversation archives it rather than hard-deleting
    Given a conversation I own
    When I delete it
    Then a "conversation_archived" event is recorded
    And the conversation stops appearing in my list
    And the underlying ClickHouse rows are not hard-deleted

  Scenario: Clearing memory archives all of my conversations
    Given I own several conversations
    When I clear my Langy memory
    Then a "conversation_archived" event is recorded for each
    And the returned count matches the number archived

  Scenario: A non-owner cannot archive someone else's conversation
    Given a conversation owned by another user and not shared to me for control
    When I attempt to delete it
    Then no "conversation_archived" event is recorded
    And the delete reports not-found or not-owned

  # ============================================================================
  # Rename and share (metadata) — beyond the prescribed vocabulary (see ADR-043)
  # ============================================================================

  @review
  Scenario: Renaming or sharing updates metadata via one event
    Given a conversation I own
    When I rename it or toggle sharing
    Then a "conversation_metadata_updated" event is recorded
    And the fold reflects the new title or sharing state
