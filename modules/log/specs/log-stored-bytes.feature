# ADR-202 Decided 20: data-retention's storage meter asks each owning module for its stored bytes.

Feature: Log answers the storage meter with its own stored bytes

  data-retention's storage meter asks log for one project's stored bytes:
  the sum of `_size_bytes` over log's own `log_records`, read for that project alone.
  The legacy `stored_log_records` no longer counts (ADR-202 Decided 22).

  @integration
  Scenario: Log's stored bytes count only this project's rows
    Given log records stored for this project and for another project
    When the storage meter asks log for this project's stored bytes
    Then the answer equals the sum of `_size_bytes` over this project's rows alone

  @unit
  Scenario: Log's stored bytes before a cutoff count only rows whose partition time is earlier
    Given the storage meter asks log for one project's stored bytes before a cutoff
    When log builds the read
    Then it keeps only rows whose `TimeUnixMs` is before the cutoff
    And without a cutoff it filters on no time
