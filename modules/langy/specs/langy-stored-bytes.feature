# ADR-202 Decided 20: data-retention's storage meter asks each owning module for its stored bytes.

Feature: Langy answers the storage meter with its own stored bytes

  data-retention's storage meter asks langy for one project's stored bytes:
  the sum of `_size_bytes` over langy's own `langy_analytics_events`, read for that project alone.

  @integration
  Scenario: Langy's stored bytes count only this project's rows
    Given langy analytics rows stored for this project and for another project
    When the storage meter asks langy for this project's stored bytes
    Then the answer equals the sum of `_size_bytes` over this project's rows alone
