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

  @integration
  Scenario: Running a batch queues all approved variants under one shared run
    When I click "Run approved"
    Then all 5 approved variants are queued under the same batch run

  @integration
  Scenario: Running a batch moves it to dispatching
    When I click "Run approved"
    Then the batch status becomes dispatching
    And the batch records the run its variants were queued under

  @integration
  Scenario: The seed itself runs alongside the variants as a baseline
    When I click "Run approved"
    Then the original seed scenario is also queued as part of the same batch run

  @integration
  Scenario: Each dispatched variant records the run it was dispatched under
    When I click "Run approved"
    Then every approved variant stores the run id it was queued under
    And that id is the one its own run was queued with

  @integration
  Scenario: A dispatched run records what it ran against
    When I click "Run approved"
    Then each queued run carries both the target it runs against and which kind of target it is

  @integration
  Scenario: Running a batch with nothing approved is refused
    Given no variant in the batch is approved
    When I try to run the batch
    Then the run is refused with a named error
    And nothing is queued

  @integration
  Scenario: Running a batch from another project is refused
    Given a fan-out batch that belongs to a different project
    When I try to run it from my project
    Then the run is refused with a named error
    And nothing is queued

  # ============================================================================
  # Report
  # ============================================================================

  @integration
  Scenario: View the blast radius once all runs finish
    Given a batch run has finished
    When I open the blast radius report
    Then every variant shows the verdict of the run it was dispatched under

  @unit
  Scenario: The report shows the seed's own result for comparison
    Given the seed was run as a baseline alongside the variants
    When I open the blast radius report
    Then I see the seed's own result
    And the seed is not counted in the blast radius ratio

  @integration
  Scenario: Report shows a per-lens breakdown
    Given a batch run has finished with variants across multiple lenses
    When I open the blast radius report
    Then I see failure counts broken down by lens

  @integration
  Scenario: Report updates while runs are still in progress
    Given a batch run has some variants still running
    When I open the blast radius report
    Then already-finished variants show their verdict
    And still-running variants show a running state

  @integration
  Scenario: Reporting on a batch that has not run is refused
    Given a fan-out batch that has never been dispatched
    When I open the blast radius report
    Then I see a named error telling me to run the batch first

  @integration
  Scenario: Reporting on a batch from another project is refused
    Given a fan-out batch that belongs to a different project
    When I ask for its blast radius report from my project
    Then the report is refused with a named error

  @unit
  Scenario: Blast radius is the ratio of failed to total variants
    Given a batch run has finished with 3 of 7 variants failing
    When the blast radius report is computed
    Then the reported blast radius is 3/7

  # ============================================================================
  # Library
  # ============================================================================

  @integration
  Scenario: Failing variants stay visible in the scenario library
    Given a batch run has finished with a failing, approved variant
    When I open the scenario library
    Then that variant's scenario is listed, labeled as a fan-out finding
    And it is not silently archived

  # ============================================================================
  # Promotion (deferred)
  # ============================================================================
  # Issue #6123 asks for passing variants to be promotable into a regression
  # suite. It is not built: this describes the intent, and nothing in the schema
  # or services records a promotion until it is.

  @e2e @unimplemented
  Scenario: Promote passing variants to a regression suite
    Given a batch run has finished with 3 passing, approved variants
    When I select those variants in the report
    And I click "Promote to regression suite"
    And I pick an existing suite
    Then those 3 variants' scenarios are added to that suite
