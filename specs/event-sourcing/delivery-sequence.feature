@unit
Feature: Every staged job carries a sequence that identifies the delivery
  A projection has to tell a retry from a genuinely new arrival, and it cannot
  do that by looking at the events. A retry carries the same events; so does a
  redelivery after a crash. Event time cannot separate them either, because a
  late arrival also sorts below whatever was applied last, and late arrivals are
  normal — the stream is unordered before it reaches us.

  What genuinely repeats is the delivery. So each job is stamped, when it is
  staged, with a number that increases within its own group. A projection
  records the last one it applied; a job presenting that number again has
  already been applied and is skipped.

  Two properties make it work, and both are about the stamp rather than the
  events. It is assigned inside the same atomic step that inserts the job, so a
  job cannot exist without one or share one with a sibling. And a retry presents
  the number it was first given rather than a fresh one — a retry that looked
  new would be applied twice, which is the entire failure the stamp exists to
  prevent. (ADR-098.)

  Background:
    Given a queue that groups work by tenant, lane and aggregate

  Scenario: Two jobs staged into one group get increasing sequences
    When two jobs are staged into the same group
    Then the second carries a higher sequence than the first

  Scenario: Two groups do not share a sequence space
    When a job is staged into one group and another into a different group
    Then neither sequence is affected by the other group's numbering

  Scenario: A job cannot be staged without a sequence
    When a job is staged
    Then it carries a sequence

  Scenario: A job cannot be staged without a sequence — readable off the header alone
    When a job is staged
    Then its sequence can be read without decoding the job's body

  Scenario: A retried job presents the same sequence it was first staged with
    Given a job that has been staged and then retried
    When the retry is delivered
    Then it presents the sequence from its first staging, not a new one

  Scenario: A retried job presents the same sequence it was first staged with — decode round trip
    Given a job that has been staged, retried, and decoded again
    When its sequence is read back
    Then it is the sequence from the first staging

  Scenario: A dedup squash on an unconsumed job keeps its original sequence
    Given a job that is superseded before anything consumed it
    When the surviving job is delivered
    Then it carries the sequence the original was staged with

  Scenario: A GQ1 envelope's sequence survives a compressed, offloaded body
    Given a job whose body is large enough to be compressed and stored apart
    When it is delivered and its body is resolved
    Then its sequence is unchanged by the round trip

  Scenario: A GQ1/GQ2 envelope's sequence survives a compressed, offloaded body
    Given jobs in both envelope formats whose bodies are stored apart
    When each is delivered and its body resolved
    Then each sequence is unchanged by the round trip
