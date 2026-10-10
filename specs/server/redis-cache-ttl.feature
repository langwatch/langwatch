Feature: Every Redis cache key expires
  Redis is one instance running noeviction, so queues, the outbox and locks are
  never evicted. A cache key that never expires is memory nothing reclaims:
  every cache repository's write carries a short TTL in the same command, and
  Redis's own expiry is the only sweeper (Alex, 2026-10-01; ARCHITECTURE §7).

  @unit
  Scenario: A Redis cache repository writes no key without its expiry
    Given every file named redis.<subject>-cache.repository.ts
    When each Redis write it makes is read
    Then every write carries its expiry in the same atomic command
    And a fold cache names its TTL when it wraps the durable fold store

  @unit
  Scenario: A rate-limit counter is never left without its expiry
    Given a counter that Redis increments for a rate limit
    When it is counted
    Then the count and its expiry are one atomic script
    And a counter found without an expiry is given one, while a live window is never extended

  @unit
  Scenario: A Better Auth value with no time left is deleted, never written bare
    Given Better Auth stores a value through secondary storage
    When the time it has left is zero or less
    Then the key is deleted rather than written without an expiry

  @unit
  Scenario: The expiry check reads every Redis-writing repository, whatever its client is called
    Given the Better Auth secondary storage and the cache repositories
    When a write is made through a client named anything at all
    Then the check still finds it and refuses it without an expiry
