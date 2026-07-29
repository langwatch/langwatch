Feature: A row the storage cannot read is rebuilt, not retried forever

  A stored aggregate row can become physically unreadable while the storage
  itself is perfectly healthy. The case that put this here: a list-valued column
  added to an existing table without a declared empty default leaves every row
  written before the addition with no value to return, and the storage answers a
  read of it by trying to reserve an absurd amount of memory and failing. The
  row is complete; this build simply cannot decode it, and no amount of waiting
  changes that.

  That failure looks nothing like an outage, and must not be treated as one.
  Retrying an unreadable row re-runs a read that can never succeed, fails the
  job again, and the queue redelivers it — the aggregate's group stops making
  progress and every other aggregate behind it waits. The read-back exists so a
  fold can continue from committed state; when the committed state cannot be
  read, the honest answer is that there is no usable state, which is exactly the
  answer that makes the fold rebuild from the event history and write the row
  back in a form this build CAN read. The failure heals itself.

  The distinction that carries this is permanent-versus-transient. A storage
  that is overloaded, timing out, or unreachable must still be retried — its
  rows are fine and will read on the next attempt. Only a row whose decode can
  never succeed is reported as unusable state. (ADR-066.)

  Background:
    Given a fold projection that continues from a read-back of its committed row
    And the fold is configured to rebuild from event history when the read-back
      reports no usable state

  Scenario: an unreadable row is reported as unusable state rather than failing the job
    Given the stored row exists but the storage cannot decode one of its columns
    When the fold reads the row back
    Then the read-back reports no usable state
    And it reports it as a row that was found and refused, not as a missing row
    And the job does not fail

  Scenario: the rebuild rewrites the row so the next read succeeds
    Given the stored row exists but the storage cannot decode one of its columns
    When the fold reads the row back and rebuilds from event history
    Then the rebuilt state is written back over the unreadable row
    And a later read of the same aggregate answers from the stored row

  Scenario: a storage that is merely unavailable is still retried
    Given the storage is unreachable or refusing work
    When the fold reads the row back
    Then the failure propagates so the queue redelivers the job
    And the row is not treated as unusable state

  Scenario: a storage that runs out of memory answering a query is still retried
    Given the query exceeds the storage's memory allowance for a single query
    When the fold reads the row back
    Then the failure propagates so the queue redelivers the job
    And the row is not treated as unusable state

  Scenario: refusing an unreadable row is never allowed to lose committed state
    Given the stored row exists but the storage cannot decode one of its columns
    And the aggregate's event history reads back empty
    When the fold reads the row back and the rebuild produces nothing
    Then the fold refuses to write, rather than overwriting the committed row
      with a partial one
