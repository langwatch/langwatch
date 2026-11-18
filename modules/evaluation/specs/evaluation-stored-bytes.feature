# ADR-202 Decided 20: data-retention's storage meter asks each owning module for its stored bytes.

Feature: Evaluation answers the storage meter with its own stored bytes

  data-retention's storage meter asks evaluation for one project's stored bytes:
  the sum of `_size_bytes` over evaluation's own run table, read for that project alone.

  @integration
  Scenario: Evaluation's stored bytes count only this project's rows
    Given evaluation runs stored for this project and for another project
    When the storage meter asks evaluation for this project's stored bytes
    Then the answer equals the sum of `_size_bytes` over this project's rows alone

  @unit
  Scenario: Evaluation's stored bytes before a cutoff count only rows whose partition time is earlier
    Given the storage meter asks evaluation for one project's stored bytes before a cutoff
    When evaluation builds the read
    Then it keeps only rows whose `ScheduledAt` is before the cutoff
    And without a cutoff it filters on no time
