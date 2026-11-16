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
