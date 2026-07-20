Feature: Live dataset-processing progress

  When a large dataset is uploaded it is prepared in the background, which for a
  multi-GB file takes minutes. Instead of a silent "Processing", the user sees a
  live bar — percent complete, bytes processed of the total, a running row count,
  an estimated time remaining, and which phase the preparation is in — and it
  always settles on a definite outcome, even if they look away and come back.

  # Behaviour derived from ADR-034 (dev/docs/adr/034-dataset-processing-progress.md).
  # Progress while running is real-time but ephemeral; the final outcome is durable.
  #
  # Scenarios are @unimplemented until a scenario test binds each one: the v1 PR
  # covers the pieces at the unit level (producer ordering + denominator, the
  # terminal-authority view logic, and the broadcast wire) but not these
  # end-to-end flows. Drop @unimplemented on a scenario as its binding test lands.

  Background:
    Given I am logged in
    And I have access to a project

  # ============================================================================
  # Live progress
  # ============================================================================

  @integration @unimplemented
  Scenario: A large dataset shows live progress while it is prepared
    Given I have uploaded a large dataset that is being prepared
    When I watch its progress
    Then I see the percent complete advancing
    And I see how many rows have been processed so far
    And I see an estimate of the time remaining
    And the percent never exceeds 100 and only reaches 100 when preparation finishes

  @integration @unimplemented
  Scenario: The progress stepper shows which phase preparation is in
    Given a dataset that is being prepared
    When I watch its progress
    Then I see it move through uploading, processing, and finalizing
    And it settles on ready when preparation finishes

  # ============================================================================
  # The bar always reaches a definite outcome (I-TERMINAL-REACHED)
  # ============================================================================

  @integration @unimplemented
  Scenario: A dataset that finished preparing before I opened it shows ready, not a stuck bar
    Given a dataset whose preparation already finished
    When I open it after preparation has finished
    Then it shows as ready
    And I never see a progress bar stuck partway

  @integration @unimplemented
  Scenario: Preparation that fails is shown as failed with a way to retry
    Given a dataset whose preparation failed
    When I open it
    Then it shows as failed
    And I am offered a way to retry preparation
    And the failure is still shown after I refresh the page

  # ============================================================================
  # Resilience
  # ============================================================================

  @integration @unimplemented
  Scenario: Refreshing mid-preparation shows progress again
    Given a dataset that is being prepared
    When I refresh the page while it is still preparing
    Then I see it is still preparing
    And the live percent reappears as preparation continues

  @integration @unimplemented
  Scenario: Progress for one project's dataset is never shown to another project
    Given a dataset being prepared in my project
    When another project subscribes to progress
    Then it receives no progress for my dataset

  # ============================================================================
  # Bulk
  # ============================================================================

  @integration @unimplemented
  Scenario: Several datasets uploaded together each show their own live progress
    Given I have uploaded several large datasets together
    When I watch the upload drawer
    Then each one shows its own percent, row count, and phase
    And one finishing does not disturb the others
