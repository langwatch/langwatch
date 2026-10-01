Feature: The process-manager inbox keys idempotency on a bounded digest
  As the platform
  I want a process manager's idempotency marker to be keyed on a fixed-width digest
  So that a long source event id cannot wedge a process for good

  # A process manager consumes each source event exactly once. The marker for
  # that is a row in `ProcessManagerInbox`, unique on
  # (processName, projectId, <source event>).
  #
  # The source event id is `idempotencyKey ?? id`, and an idempotency key is
  # composed by the pipeline that emits the command — so its length is
  # whatever the emitting domain happens to concatenate. Postgres refuses to
  # index a btree row over ~2704 bytes, so a long enough key turned the inbox
  # insert into a hard error (SQLSTATE 54000) INSIDE the commit transaction.
  #
  # That error is deterministic. It fails, the whole commit rolls back, the
  # queue retries, it fails identically, and at the end of the retry ladder the
  # group is blocked (packages/group-queue/specs/poison-group-park-guard.feature).
  # Since the group is per-aggregate, one oversized event id permanently stops
  # every later event for that aggregate — including the ones that dispatch
  # real work.
  #
  # The fix is to stop indexing caller-sized data at all: the store derives a
  # fixed-width digest of the source event id and puts the unique constraint on
  # THAT, keeping the raw id as an unindexed column for diagnostics. The
  # constraint is then the same width no matter what any pipeline concatenates,
  # so this class of failure cannot come back through a different domain.
  #
  # See specs/langy/langy-tool-call-identity.feature for the specific defect
  # that exposed this, and ADR-052 for the process-manager substrate.

  Rule: The inbox's unique constraint is a fixed width whatever the source event id

    @integration
    Scenario: A source event id far past the index limit is still consumed
      Given a process manager subscribed to an event
      And that event's idempotency key is several thousand characters long
      When the process commits its consumption of the event
      Then the commit succeeds
      And the raw source event id is kept on the row for diagnostics

    @integration
    Scenario: Two different long source event ids stay distinct
      Given two events whose idempotency keys are long and share a common prefix
      When a process manager commits its consumption of each of them
      Then both are consumed
      And neither is mistaken for a redelivery of the other

    @integration
    Scenario: Redelivery of a long source event id is still deduplicated
      Given a process manager has consumed an event with a very long idempotency key
      When the same event is delivered to it again
      Then the second delivery is reported as a duplicate
      And no second inbox row is written

    @integration
    Scenario: A long source event id no longer blocks the process
      Given a process manager subscribed to an event whose idempotency key exceeds the index limit
      When the event is delivered
      Then the commit does not raise a database error
      And a later event for the same process is still processed

  Rule: The digest is derived by the store, never by the caller

    @unit
    Scenario: The same source event id always derives the same key
      Given a source event id
      When its inbox key is derived twice
      Then both derivations produce the same value

    @unit
    Scenario: The derived key is a fixed width regardless of input length
      Given a very short source event id and a very long one
      When each one's inbox key is derived
      Then the two keys are the same length
