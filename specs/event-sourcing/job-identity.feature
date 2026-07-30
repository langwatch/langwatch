# Design: dev/docs/adr/108-the-dispatch-plane.md
Feature: A job's identity is fixed at staging, and its sequence is readable without its body
  What genuinely repeats in this system is the delivery, not the event. So each
  job is stamped, when it is staged, with a sequence that increases within its
  own lane. That number names one delivery: a durable effect's message key is
  built from it, and the dispatch plane's scheduler, metrics and parked-lane
  report all read it off the envelope without decoding the job.

  It is deliberately not a projection column. A fold is required to be a
  function of the SET of the events it has seen, so re-applying a delivery
  reaches the state it already had and there is nothing to skip (ADR-107
  decision 8). A per-row guard would have bought idempotence for a fold that
  had not earned it.

  Two properties make the stamp work, and both are about the envelope rather
  than the events. The header carrying the sequence sits in front of the body
  as its own segment, so it is parsed independently of a body that may be 4 MiB
  wide (ADR-108 decision 6). And a retry presents the sequence and identity it
  was first given rather than a fresh one, so the message key a durable effect
  derives from it stays stable across attempts.

  There is one envelope format. The old plane maintained two (GQ1 and GQ2) with
  parallel decode paths, and a staged id that gained a segment per retry and
  per operator unblock. The queue is transient — nothing in it outlives a
  restart by design — so no migration is owed and neither is carried forward: a
  job's identity is the header's own fields, fixed at staging, and a retry only
  ever advances `attempt`.

  Background:
    Given a lane that assigns sequences to the jobs staged into it

  Rule: A sequence is assigned once, at staging, and never shared

    @unit
    Scenario: Two jobs staged into one lane get increasing sequences
      When two jobs are staged into the same lane
      Then the second carries a higher sequence than the first

    @unit
    Scenario: Two lanes do not share a sequence space
      When a job is staged into one lane and another into a different lane
      Then neither sequence is affected by the other lane's numbering

    @unit
    Scenario: A job cannot be staged without a sequence
      When a job is staged
      Then it carries a sequence

  Rule: The header is a segment in front of the body, read independently of it

    @unit
    Scenario: A job's sequence is readable without decoding its body
      Given an encoded job whose body is large
      When its sequence is read
      Then it is read without parsing the body at all

    @unit
    Scenario: Reading a job's header costs nothing proportional to the body's size
      Given an encoded job with a multi-megabyte body
      When its header is read
      Then the amount of the body inspected does not grow with the body's size

    @unit
    Scenario: The header and body round-trip losslessly
      Given a job whose body is an arbitrary opaque string
      When it is encoded and then decoded
      Then the decoded body is byte-for-byte identical to the original

    @unit
    Scenario: A body that stands in for a compressed, spool-offloaded payload round-trips unchanged
      Given a job whose body and blob reference stand in for an offloaded payload
      When it is encoded and then decoded
      Then the body is unchanged and the header's blob reference is unchanged

  Rule: A job's identity is the header's own fields, fixed at staging

    @unit
    Scenario: A job's identity names the tenant, the lane, the aggregate and the event, and nothing else
      Given a job staged for an event
      When its header is read
      Then it names the tenant, the lane, the aggregate and the event
      And it carries no growing id and no timestamp segment

    @unit
    Scenario: A retried job presents the same sequence it was first staged with
      Given a job that has been staged and then retried
      When the retry is delivered
      Then it presents the sequence from its first staging, not a new one

    @unit
    Scenario: A retried job's identity survives a decode round trip
      Given a job that has been staged, retried, and decoded again
      When its sequence and aggregate id are read back
      Then they are the values from the first staging

    @unit
    Scenario: Advancing a job's attempt leaves every other header field and the body untouched
      Given a staged job carrying an attempt
      When it is advanced to its next attempt
      Then its sequence, aggregate id and event id are unchanged
      And its body bytes are unchanged

    @unit
    Scenario: A job stays readable as its attempt count grows
      Given a job advanced through several attempts of different digit widths
      When each one is read back
      Then every one reports the attempt it was given, and nothing else drifts

  Rule: There is one envelope format

    @unit
    Scenario: A malformed header is refused rather than guessed at
      Given an encoded value whose header segment is not valid
      When it is decoded
      Then decoding fails rather than falling back to a second format
