# ADR-202 Decided 20: data-retention's storage meter asks each owning module for its stored bytes.

Feature: Scenario answers the storage meter with its own stored bytes

  data-retention's storage meter asks scenario for one project's stored bytes:
  the sum of `_size_bytes` over scenario's own run table, read for that project alone.

  @integration
  Scenario: Scenario's stored bytes count only this project's rows
    Given scenario runs stored for this project and for another project
    When the storage meter asks scenario for this project's stored bytes
    Then the answer equals the sum of `_size_bytes` over this project's rows alone

  @unit
  Scenario: Scenario's stored bytes before a cutoff count only rows whose partition time is earlier
    Given the storage meter asks scenario for one project's stored bytes before a cutoff
    When scenario builds the read
    Then it keeps only rows whose `StartedAt` is before the cutoff
    And without a cutoff it filters on no time

  @unit
  Scenario: Scenario counts the items a shorter period would remove
    Given data retention asks scenario how many runs a period of 91 days would remove
    When scenario builds the count for one project on the reader identity
    Then it counts distinct `ScenarioRunId` whose `StartedAt` is before the cutoff
    And only rows kept forever or for longer than 91 days are counted

  @unit
  Scenario: Scenario refuses a past-retention count without a period
    When data retention asks scenario for a past-retention count with a period of 0 days, or without a cutoff
    Then the input is refused before any read
