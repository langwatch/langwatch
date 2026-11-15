# ADR-202 Decided 20: data-retention's storage meter asks each owning module for its stored bytes.

Feature: Suite answers the storage meter with its own stored bytes

  data-retention's storage meter asks suite for one project's stored bytes:
  the sum of `_size_bytes` over suite's own table, read for that project alone.

  @integration
  Scenario: Suite's stored bytes count only this project's rows
    Given suite runs stored for this project and for another project
    When the storage meter asks suite for this project's stored bytes
    Then the answer equals the sum of `_size_bytes` over this project's rows alone
