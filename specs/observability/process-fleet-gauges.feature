Feature: The process-manager fleet gauges report once a source is bound

  pm_instances and pm_outbox_* are observable gauges. They report nothing
  until a process binds a source, and nothing again once it unbinds.

    # Bindings: packages/eventing/src/process-manager/__tests__/metrics.unit.test.ts
    # and modules/ops/process/src/app/__tests__/ops-installation.unit.test.ts

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

  @unit
  Scenario: A failed scheduled fleet read keeps the last counts
    Given the fleet has a saved reading
    When the scheduled fleet read fails
    Then the saved reading remains unchanged

  @unit
  Scenario: Stale fleet counts report a failed collection
    Given the shared fleet counts were taken longer ago than a few collection wakes
    When the fleet gauges are collected
    Then the fleet collection success gauge reads 0
    And its last-success time does not advance

  @unit
  Scenario: A booted worker reports the fleet gauges; api pods do not
    Given the scheduled collector has shared the fleet counts
    When a worker and an api process boot and their gauges are collected
    Then the worker reports pm_instances and pm_outbox_* per process name
    And the api process reports none of them
