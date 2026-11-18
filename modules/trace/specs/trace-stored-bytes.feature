# ADR-202 Decided 20: data-retention's storage meter asks each owning module for its stored bytes.

Feature: Trace answers the storage meter with its own stored bytes

  data-retention's storage meter asks trace for one project's stored bytes: the sum of
  `_size_bytes` over trace's spans and trace summaries, read for that project alone. The legacy
  stored log records are not counted (ADR-202 Decided 22).

  @unit
  Scenario: The stored-bytes read is one tenant's built sum over spans and summaries
    Given the storage meter asks trace for one project's stored bytes
    When trace builds the read
    Then it reads spans and trace summaries for that project alone, on the reader identity
    And it sums both tables' `_size_bytes` under the meter's thread and time caps

  @integration
  Scenario: Trace's stored bytes count only this project's rows
    Given a span and a trace summary stored for this project and for another project
    When the storage meter asks trace for this project's stored bytes
    Then the answer is the `_size_bytes` of this project's span and summary alone

  @unit
  Scenario: Trace's stored bytes before a cutoff count only rows whose partition time is earlier
    Given the storage meter asks trace for one project's stored bytes before a cutoff
    When trace builds the read
    Then it keeps only rows whose partition time (a span's `StartTime`, a summary's `OccurredAt`) is before the cutoff
    And without a cutoff it filters on no time

  @unit
  Scenario: Trace counts the items a shorter period would remove
    Given data retention asks trace how many traces a period of 91 days would remove
    When trace builds the count for one project on the reader identity
    Then it counts distinct `TraceId` whose `OccurredAt` is before the cutoff
    And only rows kept forever or for longer than 91 days are counted

  @unit
  Scenario: Trace refuses a past-retention count without a period
    When data retention asks trace for a past-retention count with a period of 0 days, or without a cutoff
    Then the input is refused before any read
