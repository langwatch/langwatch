Feature: Langy projects canonical ClickHouse events into Postgres operational state
  As a Langy user
  I want conversations and turns to react immediately and recover reliably
  So that analytical lag or an ephemeral cache cannot delay, lose, or duplicate my work

  Background:
    Given Langy is enabled for my project
    And ClickHouse event_log is the sole source of truth for Langy events
    And Postgres holds Langy's rebuildable operational projections

  @integration
  Scenario: A committed event takes the queue hot path into Postgres
    Given I own a Langy conversation
    When I send a message with a fixed idempotency identity
    Then the full event is durably appended to ClickHouse before it is queued
    And the queue envelope carries the event needed by the operational fold
    And the conversation row commits its count and activity with its cursor
    And the message row converges independently under its deterministic identity
    And the normal fold path does not read the event back from ClickHouse

  @integration
  Scenario: A failed Postgres fold does not invalidate the accepted event
    Given a Langy event was durably appended and queued
    When one Postgres projection store fails before its row is written
    Then the canonical event remains in ClickHouse
    And that projection row remains unchanged
    And the queued event is retried with the same event identity

  @integration
  Scenario: A dispatch gap is repaired from the canonical event log
    Given a Langy event was durably appended to ClickHouse
    But staging its queue envelope failed
    When the event-log repair job reaches that event
    Then it stages the same deterministic queue job
    And the Postgres projection converges without applying the event twice

  @integration
  Scenario: Retrying the same command does not fold twice
    Given a message event already exists and its Postgres fold committed
    When the caller retries the same logical command
    Then no second event or message is appended
    And conversation counters remain unchanged
    And the original committed result is returned

  @integration
  Scenario: Concurrent commands preserve conversation order
    Given two commands target the same conversation concurrently
    When both are accepted
    Then their events have distinct identities in the canonical event log
    And GroupQueue presents them to the operational fold in canonical stream order
    And the Postgres projection reflects both events in that order

  @unit
  Scenario: A started turn creates one process intent
    Given a conversation process has no turn in flight
    When it consumes an agent-response-started event
    Then it records that turn as running
    And it records one worker-dispatch intent
    And it does not schedule a liveness wake-up
    And it does not query a read projection to make the decision

  @integration
  Scenario: Duplicate process delivery does not duplicate work
    Given a started-turn event was already consumed by the conversation process
    When the same event is delivered again
    Then process state changes only once
    And exactly one logical worker-dispatch intent exists

  @unit
  Scenario: Durable activity alone cannot decide worker liveness
    Given an agent turn is running
    When durable tool or plan events are committed for that turn
    Then the pilot process schedules no wake-up
    And it records no redispatch or failure intent
    And the heartbeat-aware liveness subscriber remains the sole owner until observed heartbeat input exists

  @integration
  Scenario: A committed process intent survives a worker restart
    Given process state and an undispatched intent committed together
    When the event-sourcing worker stops before dispatch
    And another worker starts
    Then the intent is leased and dispatched with the same logical identity

  @unit
  Scenario: A manual title remains authoritative
    Given I renamed a conversation
    When later completed turns reach the conversation process
    Then no automatic-title intent is recorded

  @unit
  Scenario: Automatic title generation occurs only at the first logical completion
    Given the conversation title is still derived
    When the first agent turn completes successfully
    Then exactly one automatic-title intent is recorded for that turn
    When later turns complete or timers pass
    Then no later automatic-title intent is recorded

  @integration
  Scenario: A freshness subscriber carries no conversation data
    Given a queued conversation event was committed to the Postgres fold
    When the post-fold freshness subscriber receives that event
    Then it broadcasts only an invalidation signal
    And the client reads the already-committed Postgres state
    And the subscriber never receives or broadcasts a folded row

  @integration
  Scenario: A disconnected durable subscriber resumes from queued work
    Given a durable Langy subscriber was stopped while events were queued
    When the subscriber starts again
    Then GroupQueue resumes its pending and retry work
    And it consumes every missing event in stream order
    And it does not read ClickHouse on the normal recovery path

  @integration
  Scenario: Projection replay is side-effect free
    Given canonical Langy events are read from ClickHouse for an explicit replay
    When the replay completes
    Then no worker is dispatched
    And no failure command is emitted
    And no title is generated
    And no live freshness signal is broadcast

  @integration
  Scenario: Analytical projection lag does not affect the conversation
    Given ClickHouse event-log writes remain available
    And the Langy analytical projections are paused
    When I send messages and complete a turn
    Then the Langy conversation converges through the queue into Postgres
    And no workflow decision queries a ClickHouse analytical projection
    When the analytical projections resume
    Then the missing analytics events catch up from the canonical event log or queued events

  @integration
  Scenario: Analytics events do not read old projection state
    Given a canonical Langy event is delivered more than once
    When its ClickHouse analytics event is projected
    Then the projection does not read an old analytical row before writing
    And no Redis cache is read or written
    And one logical analytics row exists for the source event identity
    And aggregate totals count that source event once

  @integration
  Scenario: Redis loss cannot erase accepted work
    Given a message, process state, and effect intent are committed
    When Redis becomes unavailable
    Then the live token stream may disconnect
    But the accepted event remains in ClickHouse
    And the message, process state, and effect intent remain recoverable

  @security
  Scenario: Private process storage contains no conversation content
    When process inbox, state, and outbox rows are stored
    Then they may contain tenant, stream, event, timer, and effect identities
    But they do not contain prompts, message parts, tool output, credentials, run tokens, or handoff tokens

  @integration
  Scenario: The completed branch has one owner for each effect
    Given the Langy process manager and process outbox are active
    Then only the process outbox can perform the initial worker dispatch
    And only the process outbox can request automatic title generation
    And broadcast and liveness are direct event subscribers
    And only the liveness subscriber may re-dispatch a stalled turn
    And no legacy spawn, title, or projection-reactor bridge is registered
