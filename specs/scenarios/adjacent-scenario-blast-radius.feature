Feature: Blast Radius Execution and Reporting
  As a LangWatch user
  I want approved variants to run and their results aggregated
  So that I see how far a bug class extends before promoting fixes or filing more work

  Background:
    Given I am logged into project "my-project"
    And a fan-out batch has 5 approved variants

  # ============================================================================
  # Dispatch
  # ============================================================================

  @integration @unimplemented
  Scenario: Running a batch queues all approved variants under one shared run
    When I click "Run approved"
    Then all 5 approved variants are queued under the same batch run
    And the batch status becomes dispatching

  @integration @unimplemented
  Scenario: The seed itself runs alongside the variants as a baseline
    When I click "Run approved"
    Then the original seed scenario is also queued as part of the same batch run

  # ============================================================================
  # Report
  # ============================================================================

  @e2e @unimplemented
  Scenario: View the blast radius once all runs finish
    Given a batch run has finished with 2 of 5 variants failing
    When I open the blast radius report
    Then I see "2 of 5 adjacent scenarios also failed"
    And I see the seed's own result for comparison

  @integration @unimplemented
  Scenario: Report shows a per-lens breakdown
    Given a batch run has finished with variants across multiple lenses
    When I open the blast radius report
    Then I see failure counts broken down by lens

  @integration @unimplemented
  Scenario: Report updates while runs are still in progress
    Given a batch run has some variants still running
    When I open the blast radius report
    Then already-finished variants show their verdict
    And still-running variants show a running state

  # ============================================================================
  # Promotion
  # ============================================================================

  @e2e @unimplemented
  Scenario: Promote passing variants to a regression suite
    Given a batch run has finished with 3 passing, approved variants
    When I select those variants in the report
    And I click "Promote to regression suite"
    And I pick an existing suite
    Then those 3 variants' scenarios are added to that suite

  @integration @unimplemented
  Scenario: Failing variants stay visible in the scenario library
    Given a batch run has finished with a failing, approved variant
    When I open the scenario library
    Then that variant's scenario is listed, labeled as a fan-out finding
    And it is not silently archived

  @unit @unimplemented
  Scenario: Blast radius is the ratio of failed to total variants
    Given a batch run has finished with 3 of 7 variants failing
    When the blast radius report is computed
    Then the reported blast radius is 3/7
