# ADR-202 Decided 20: data-retention's storage meter asks each owning module for its stored bytes.

Feature: Scenario answers the storage meter with its own stored bytes

  data-retention's storage meter asks scenario for one project's stored bytes:
  the sum of `_size_bytes` over scenario's own run table, read for that project alone.

  @integration
  Scenario: Scenario's stored bytes count only this project's rows
    Given scenario runs stored for this project and for another project
    When the storage meter asks scenario for this project's stored bytes
    Then the answer equals the sum of `_size_bytes` over this project's rows alone
