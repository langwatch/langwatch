Feature: A re-reported span reads back as the report that arrived last

  An emitter can send the same span more than once — a retried export, a
  re-projection, a late correction. Each arrival is stored rather than
  overwritten, so for a while the store holds several versions of one span and
  every read has to pick one. The rule is the obvious one: a reader shows the
  most recently reported version, and shows it once.

  The trap is that a span carries two times, and only one of them can order
  versions. Its start time is the span's own — when the work began — and it is
  the same in every report of that span, so it cannot tell an earlier report
  from a later one. Picking "the version with the greatest start time" therefore
  does not pick a version at all: it picks all of them on the ordinary case,
  and on the rare case where a correction moves the start time it picks the one
  we were correcting. Ordering has to come from when we recorded the report.
  (ADR-083.)

  @integration
  Scenario: a span reported twice appears once
    Given a span has been reported
    And the same span is reported again with corrected content
    And the second report has only just arrived
    When a reader loads the trace
    Then the span appears exactly once
    And it shows the corrected content

  @integration
  Scenario: readers agree with each other about which report is current
    Given a span has been reported more than once
    When the trace is loaded through any surface that shows spans
    Then every surface shows the same report of that span

  @integration
  Scenario: a correction that moves the span's start time is still the current report
    Given a span has been reported
    And the same span is reported again with an earlier start time
    When a reader loads the trace
    Then the reader shows the later report, not the earlier one

  # ---------------------------------------------------------------------------
  # Deferred — the storage layer still elects on start time.
  #
  # Correcting this means rebuilding the span store onto the recorded-at
  # ordering, which cannot be done in place and is planned as an operator
  # procedure rather than an automatic upgrade step. Until then the readers are
  # right and the maintenance pass is not, and the two only ever disagree for a
  # span whose start time changed between reports — which the store already
  # could not have handled for an unrelated reason. ADR-083 §"What does not
  # ship".
  # ---------------------------------------------------------------------------

  @deferred @unimplemented
  Scenario: the report a reader shows does not change as the store settles
    Given a span has been reported
    And the same span is reported again with an earlier start time
    When enough time passes for the store to settle down to one report
    Then a reader still shows the report that arrived last
    And it shows the same report it showed before the store settled
