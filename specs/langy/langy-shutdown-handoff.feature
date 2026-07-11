Feature: Langy worker shutdown-handoff and resume-on-next-worker
  As a Langy user
  I want an in-flight turn to survive a pod termination
  So that a deploy or node drain resumes my work instead of restarting it cold

  # Behavioural contract for ADR-048. On SIGTERM the manager asks each live
  # worker to checkpoint before the process-group kill; opencode authors an
  # opaque resume token and emits it as a terminal "handoff" ndjson frame on the
  # in-flight turn stream; the control plane persists it as a durable event on
  # the langy-conversation-processing pipeline; the next turn threads it back to
  # a fresh worker, which resumes instead of cold-starting. Best-effort: an
  # uncatchable SIGKILL still falls back to a cold restart.

  Background:
    Given I am signed in with Langy enabled for project "demo"

  # ============================================================================
  # Manager: notify each worker before the drain
  # ============================================================================

  Scenario: On SIGTERM the manager notifies each live worker before killing it
    Given a worker is streaming an in-flight turn
    When the manager receives SIGTERM
    Then the manager posts a shutdown-imminent notice to that worker
    And it does so before the worker's process group is killed
    And the notice carries a deadline the worker must checkpoint before

  Scenario: The handoff deadline leaves room for the drain
    Given a graceful shutdown budget and a worker-drain budget are configured
    Then the handoff deadline plus the drain budget is less than the graceful budget
    And the manager refuses to start if that invariant does not hold

  Scenario: A worker with no turn in flight needs no handoff
    Given a worker is idle when the manager receives SIGTERM
    When the manager drains the pool
    Then no in-flight turn is lost for that worker
    And it is simply killed and cold-started on its next turn

  # ============================================================================
  # Worker: author the token, emit the terminal frame
  # ============================================================================

  Scenario: The worker emits a terminal handoff frame carrying an opaque token
    Given a worker received a shutdown-imminent notice mid-turn
    When it checkpoints the work done so far
    Then it emits a terminal "handoff" event on the turn stream
    And the frame carries a resume token that is opaque to the manager
    And the turn stream ends cleanly on that frame

  # ============================================================================
  # Control plane: persist the token durably
  # ============================================================================

  Scenario: The control plane persists the handoff token against the conversation
    Given a turn stream delivers a terminal "handoff" frame
    When the control plane consumes it
    Then a "conversation_handoff_pending" event is recorded for the conversation
    And the conversation fold stores the pending handoff token
    And the fold no longer shows a turn in flight
    And the turn is not recorded as failed

  Scenario: Recording the same handoff twice does not duplicate it
    Given a "recordTurnHandoff" command with a fixed idempotency key
    When the command is dispatched twice for the same turn
    Then exactly one "conversation_handoff_pending" event exists

  # ============================================================================
  # Resume: thread the token to a fresh worker, once
  # ============================================================================

  Scenario: The next turn resumes from the pending handoff instead of cold-starting
    Given a conversation has a pending handoff token
    When I send my next message on that conversation
    Then the resume token is passed to the fresh worker before it starts
    And the worker resumes from the checkpoint rather than a cold start

  Scenario: Consuming the pending handoff clears it exactly once
    Given a conversation has a pending handoff token
    When the next turn consumes the pending handoff
    Then a "conversation_handoff_consumed" event is recorded
    And the conversation fold no longer has a pending handoff token
    And consuming it again records no further durable event

  Scenario: A conversation with no pending handoff starts cold
    Given a conversation has no pending handoff token
    When I send my next message on that conversation
    Then no resume token is passed to the worker
    And the turn is a normal cold start

  # ============================================================================
  # Honest limit
  # ============================================================================

  Scenario: An ungraceful kill still falls back to a cold restart
    Given a worker is streaming an in-flight turn
    When the pod is SIGKILLed before any handoff frame is emitted
    Then no handoff token is persisted for the conversation
    And the reconcile sweep terminalises the orphaned turn as before
    And the next turn is a normal cold start
