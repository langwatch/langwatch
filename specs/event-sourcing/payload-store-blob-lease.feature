Feature: GroupQueue blob leases (ADR-046)
  Offloaded job bodies live under time-based leases instead of reference
  counts. A lease is set at PUT, renewed by every read, and extended by the
  operator paths (block, DLQ) whose residence can outlast it. Nothing in the
  application deletes an s3-tier object; the bucket lifecycle rule reclaims
  the durable tier.

  # Why leases (ADR-046): the holder-set refcount required every lifecycle
  # transition (stage, complete, retry, squash, drain, DLQ) to agree on hold
  # state across two processes and three Lua scripts. The coupling produced
  # the 2026-07-09 phantom-hold leak (~279K orphaned blobs) and a family of
  # races. Leases need no agreement: reads refresh, rare transitions extend.

  Background:
    Given a GroupQueue with a tiered blob store
    And the redis-tier blob lease defaults to the previous 4-day backstop

  @integration @lease
  Scenario: A redis-tier blob is written with the lease TTL
    When a job whose payload exceeds the inline ceiling is staged
    Then the redis-tier blob key carries the lease TTL

  @integration @lease
  Scenario: A worker read renews the lease
    Given an offloaded staged job
    When the worker decodes the value
    Then the blob's remaining TTL is reset to the full lease

  @integration @lease
  Scenario: The ops-dashboard peek does not renew the lease
    Given an offloaded staged job
    When an operator inspects the value through the peek path
    Then the blob's remaining TTL is unchanged

  @integration @lease @blocked
  Scenario: Blocking a group extends its blob leases past the block
    Given an offloaded job that exhausts its retries
    When the group is blocked with the value re-staged
    Then each staged value's redis-tier blob lease is extended to at least the DLQ retention window
    And a shared blob's lease is only ever extended, never shortened

  @integration @lease @dlq
  Scenario: Moving a group to the DLQ extends its blob leases to cover DLQ retention
    Given a blocked group with offloaded staged values
    When an operator moves the group to the DLQ
    Then each value's redis-tier blob lease is extended to at least the DLQ retention window
    And a replay within the retention window decodes every body

  @integration @lease @dlq
  Scenario: Replaying a group from the DLQ renews its blob leases
    Given a DLQ'd group with offloaded values
    When an operator replays the group
    Then each value's redis-tier blob lease is renewed for the live-group lease

  @integration @lease
  Scenario: A drained group's blobs are left to their leases
    Given a group with offloaded staged values
    When an operator drains the group
    Then no blob is deleted by the drain
    And the blobs expire when their leases elapse

  @lease @s3
  Scenario: The s3 tier is reclaimed by the bucket lifecycle rule, not the application
    Given an s3-tier blob whose referencing jobs have all completed
    Then no application code deletes the object
    And the documented bucket lifecycle rule reclaims it after the retention window
