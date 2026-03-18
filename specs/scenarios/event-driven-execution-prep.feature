Feature: Event-driven execution prep
  As the scenario execution system
  I need QUEUED runs to be cancellable and ad-hoc runs to go through queueRun
  So that both suite and ad-hoc paths write consistent QUEUED state to ClickHouse

  Background:
    Given the event-sourcing pipeline is active

  # ============================================================================
  # 1. QUEUED status is cancellable
  # ============================================================================

  @unit
  Scenario: QUEUED runs can be cancelled
    Given a scenario run is in QUEUED status
    When the system checks whether the run is cancellable
    Then the run is eligible for cancellation

  @unit
  Scenario: Terminal statuses remain non-cancellable
    Given a scenario run is in SUCCESS status
    When the system checks whether the run is cancellable
    Then the run is not eligible for cancellation

  # ============================================================================
  # 2. Ad-hoc runs dispatch queueRun command
  # ============================================================================

  @integration
  Scenario: Ad-hoc run dispatches queueRun command before scheduling
    Given a user triggers an ad-hoc scenario run from the UI
    When the simulation runner processes the request
    Then a queueRun command is dispatched with the scenario metadata
    And the QUEUED state is written to ClickHouse
    And the BullMQ job is scheduled after the command

  @integration
  Scenario: Ad-hoc run generates a scenarioRunId and passes it to the job
    Given a user triggers an ad-hoc scenario run
    When the simulation runner dispatches the queueRun command
    Then the same scenarioRunId is used for both the command and the BullMQ job

  @integration
  Scenario: Ad-hoc run uses the same queueRun path as suite runs
    Given the suite path dispatches queueRun via SuiteRunService
    When an ad-hoc run is triggered
    Then it dispatches queueRun through the same command interface
