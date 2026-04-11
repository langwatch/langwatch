Feature: Evaluator error details reach the UI
  As a user debugging a failed monitor
  I want to see the actual error message when an evaluator fails
  So that I can fix the underlying problem (bad credentials, unreachable endpoint, bad settings) without guessing

  Background:
    Given I am logged in
    And I have access to a project

  # ============================================================================
  # Backend error propagation
  # ============================================================================

  @integration
  Scenario: langevals returns status=error with a detail message
    Given a monitor configured for azure/content_safety
    And the Azure Safety provider is configured with an endpoint that rejects the request
    When the pipeline executes the monitor for a trace
    Then the emitted EvaluationReportedEvent has status "error"
    And the emitted event carries the real failure message in the error field
    And the emitted event does not lose the failure message

  @integration
  Scenario: evaluator throws an exception mid-execution
    Given a monitor that will raise an unexpected exception during execution
    When the pipeline executes the monitor
    Then the emitted EvaluationReportedEvent has status "error"
    And the emitted event carries the exception message in the error field
    And the emitted event carries the stack trace in the errorDetails field

  # ============================================================================
  # Frontend visibility
  # ============================================================================

  @integration
  Scenario: the trace evaluations tab shows the failure message on an errored row
    Given an evaluation run has been persisted with status "error" and an error message
    When I open the Trace Details drawer and switch to the Evaluations tab
    Then the errored evaluator row shows the error message inline
    And the error message is visually distinct from a passing row

  @integration
  Scenario: the trace evaluations tab shows details even when error message is empty
    Given a legacy evaluation run row has status "error" with only a details string and no error field
    When I open the Trace Details drawer and switch to the Evaluations tab
    Then the errored evaluator row still shows the details string as the failure explanation
