Feature: One suite at a time owns the shared ClickHouse schema
  As a developer reading a red integration shard
  I want a failure to mean my code is wrong
  So that I fix the code instead of rerunning the job until it passes

  # An integration run shares one ClickHouse database. Most fixtures isolate
  # themselves with a tenant id unique to the run, but a migration replay
  # cannot: the rollup rebuild drops a materialised view, re-derives a table
  # from the ledger and swaps it in, for every tenant at once. A suite writing
  # spend in that window loses rows the missing view never folded, and a suite
  # reading spend sees a table partway through being re-derived. Both look like
  # a wrong number rather than an error, and both repair themselves moments
  # later, which is what makes them pass on rerun.
  #
  # Vitest gives no protection here. It starts the next file's fork before the
  # previous file's hooks finish, and a worker count exported by the runner can
  # re-enable concurrent files outright.

  @integration
  Scenario: Only one process at a time holds the schema lock
    Given several processes want the schema lock at once
    When they all ask for it together
    Then each one enters and leaves before the next one enters
    And every one of them gets a turn

  @unit
  Scenario: Acquiring the lock records the holder and releasing frees it
    Given nobody holds the schema lock
    When a suite acquires it
    Then the lock names the process holding it
    And releasing it leaves the lock free for the next suite

  @unit
  Scenario: A suite holding the lock can still replay a migration
    Given a suite holds the lock for the whole of its file
    When it replays a migration inside one of its own tests
    Then the replay proceeds without waiting for itself
    And the lock is freed only when the suite is finished

  @unit
  Scenario: A suite that cannot get the lock fails loudly
    Given another live process holds the lock
    When a suite waits longer than it is allowed to
    Then it fails saying which lock it waited for and who holds it
    And the holder's lock is left untouched

  @unit
  @integration
  Scenario: A lock left by a killed run is recovered
    Given the process that held the lock no longer exists
    When another suite asks for the lock
    Then the abandoned lock is cleared and the suite proceeds

  # Recovery is where a lock protocol usually goes wrong: checking a lock and
  # then deleting it by name lets the holder release, a new holder acquire, and
  # the waiter delete the new holder's lock. Recovery therefore claims the right
  # to remove one specific owner, and abandons the claim when the owner changed.

  @unit
  Scenario: Recovery removes only the lock it inspected
    Given a suite has decided a lock was abandoned
    When the lock changes hands before the recovery claims it
    Then the new holder's lock survives
    And the recovering suite waits its turn instead

  @unit
  Scenario: A holder that lost the lock says so instead of freeing someone else's
    Given a suite's lock was removed and taken by another holder
    When the first suite releases
    Then it fails rather than freeing a lock it no longer owns
    And the new holder keeps the lock
