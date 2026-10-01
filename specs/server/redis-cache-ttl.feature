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
