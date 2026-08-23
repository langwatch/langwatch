Feature: Auth-path Redis-loss resilience
  As a person signing in to LangWatch
  I need sign-in and identity ceremonies to keep working while Redis is down
  So that an infrastructure outage never locks everyone out of the product

  # D02 of the identity platform program (ADR-007's Redis-loss amendment,
  # identity entry 2026-08-20; dev/docs/identity-platform/
  # D02-auth-path-circuit-breaker.md). The amendment is doctrine, not a
  # breaker primitive: durable appends land waited in ClickHouse, the fold
  # applies on the calling path, and everything Redis-shaped is bounded and
  # best-effort. Flag: AUTH_REDIS_FAIL_OPEN (off = previous behavior, which
  # is also the rollback).

  Background:
    Given the identity pipeline dispatches with the pinned order append, apply, stage
    And better-auth stores sessions in Postgres and Redis both

  @unit
  Scenario: A hanging Redis cannot fail or stall an identity ceremony
    Given the GroupQueue staging call hangs instead of failing fast
    When an identity ceremony dispatches
    Then the durable append and the calling-path apply land as always
    And staging is dropped at its time budget with the drop counted
    And the ceremony still succeeds

  @unit
  Scenario: Session reads fail open to the database when Redis is down
    Given Redis is configured but erroring or hanging
    When better-auth reads a session from secondary storage
    Then the read answers a miss within its time budget
    And better-auth recovers the session from Postgres

  @unit
  Scenario: Dropped secondary-storage writes are counted, never silent
    Given Redis is configured but erroring or hanging
    When better-auth writes to secondary storage
    Then the write is dropped within its time budget
    And the drop is counted and logged, because rate limiting fails open with it

  @unit
  Scenario: A dropped delete is retried out of band until Redis recovers
    Given Redis is configured but erroring when a session is revoked
    When the revocation's secondary-storage delete drops
    Then the delete is re-attempted on an interval
    And it lands once Redis recovers, and the retrying stops

  @unit
  Scenario: A delete that never lands is abandoned after the retry window, counted
    Given Redis stays down past the retry window
    When a dropped delete keeps failing its re-attempts
    Then the key is abandoned when its window closes
    And the abandonment is counted and logged without the key

  @unit
  Scenario: The retry set overflowing abandons the oldest dropped delete
    Given the retry set is at its capacity
    When another delete drops
    Then the oldest pending key is abandoned with the abandonment counted
    And the newer keys keep retrying

  @unit
  Scenario: The flag off keeps previous behavior exactly
    Given AUTH_REDIS_FAIL_OPEN is not enabled
    When better-auth uses secondary storage
    Then calls reach Redis unwrapped with no time budget
