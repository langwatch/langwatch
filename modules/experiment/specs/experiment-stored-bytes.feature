# ADR-202 Decided 20: data-retention's storage meter asks each owning module for its stored bytes.

Feature: Experiment answers the storage meter with its own stored bytes

  data-retention's storage meter asks experiment for one project's stored bytes:
  the sum of `_size_bytes` over experiment's runs, run items and DSPy steps, read for that
  project alone.

  @integration
  Scenario: Experiment's stored bytes count only this project's rows
    Given experiment runs, run items and DSPy steps stored for this project and for another project
    When the storage meter asks experiment for this project's stored bytes
    Then the answer equals the sum of `_size_bytes` over this project's rows alone
