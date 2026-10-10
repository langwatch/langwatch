# See ../adrs/026-canonical-payload-envelope.md
Feature: Group Queue payload envelope

  Group Queue stores every job in a bounded versioned envelope. A small inline
  header carries queue-owned routing and lifecycle metadata. The typed payload
  body may be raw, compressed or represented by a content reference.

  Background:
    Given a Group Queue definition with a typed payload schema

  Scenario: Large payloads are compressed when compression saves space
    When a payload above the compression threshold is staged
    And gzip plus encoding is smaller than the raw body
    Then the envelope identifies a gzip-encoded body
    And dispatch gives the handler a payload equal to the value sent

  Scenario: Small or incompressible payloads stay raw
    When a payload is below the compression threshold or compression grows it
    Then the envelope identifies a raw body
    And dispatch gives the handler a payload equal to the value sent

  Scenario: A body above the inline budget uses a content reference
    When a valid payload exceeds the inline-body budget
    Then the envelope carries a validated content reference
    And the handler receives the resolved payload

  Scenario: Scheduling reads only the bounded header
    Given a staged job whose body is held outside the envelope
    When dispatch reads its identity, group, cost, priority and attempt
    Then those values come from the envelope header
    And the payload body is not resolved

  Scenario: Advancing an attempt changes no payload bytes
    Given a staged job with a valid envelope
    When the queue advances its retry attempt
    Then only the header-owned attempt changes
    And the encoded body or content reference is unchanged

  Scenario: Coalesced siblings are decoded through the same contract
    Given several due jobs drained into one bounded batch
    When the consumer prepares the handler invocation
    Then every sibling envelope is decoded and schema-validated
    And the handler receives the jobs in queue order

  Scenario: An unsupported stored value is never application work
    Given a staged value that is not a valid Group Queue envelope
    When a consumer claims it
    Then the value is classified and reported through the queue error path
    And no application handler receives it
    And it is not counted as successful work

  Scenario: A malformed value does not wedge its group
    Given an unsupported value followed by a valid job in one group
    When the unsupported value reaches its terminal queue outcome
    Then the valid job can still be claimed and handled

  Scenario: Payload limits are checked before allocation
    Given an envelope declaring an excessive header, encoded body, decoded body, or compression ratio
    When the consumer validates it
    Then validation rejects it before allocating the declared size
    And no application handler receives it

  Scenario: Operational inspection exposes routing without payload content
    When an operator inspects a staged envelope
    Then the logical queue, group, job identity and attempt are visible
    And application payload fields are not copied into the routing view
