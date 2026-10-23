Feature: The process-manager fleet gauges report once a source is bound

  pm_instances and pm_outbox_* are observable gauges. They report nothing
  until a process binds a source, and nothing again once it unbinds.

    # Bindings: packages/eventing/src/process-manager/__tests__/metrics.unit.test.ts

  @unit
  Scenario: Unbinding at shutdown silences the gauges
    Given a source is bound and then unbound
    When the gauges are collected
    Then nothing is reported

  @unit
  Scenario: The fleet gauges read the counts the scheduled collector shared
    Given the scheduled collector has counted the fleet once
    When every process's gauges are collected twice
    Then the gauges report the shared counts
    And the tables were counted once
