@unit
Feature: A map projection writes its whole batch at once, and says when it cannot
  A map has no accumulator: each event independently produces rows, and the
  batch is written in a single go. That is not an optimisation. One write per
  event creates one part per event in a column store, and that shape has already
  taken a table down.

  The failure path matters as much as the write. A projection that fails every
  batch and counts only its successes reports a perfect success rate while its
  throughput falls to nothing, which is the one shape an alert cannot see.
  (ADR-098, ADR-100.)

  Background:
    Given a projection that derives rows from events without reading prior state

  Scenario: a failing projection is visible on the same metric as a succeeding one
    Given a store that rejects the write
    When a batch is mapped and written
    Then the failure is counted on the same measure that counts successful writes
