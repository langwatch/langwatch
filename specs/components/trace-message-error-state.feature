@regression @integration
Feature: TraceMessage error state UX

  The TraceMessage component displays trace loading status and error states.
  Error messages must differentiate between "not found" and generic errors,
  and the retry button must remain accessible during refetch.

  Scenario: displays "Trace not found" for 404 errors
    Given the trace query fails with a 404 NOT_FOUND error
    When the error state renders
    Then the alert shows "Trace not found [<trace_id>]"

  Scenario: displays "Couldn't load trace" for non-404 errors
    Given the trace query fails with a 500 INTERNAL_SERVER_ERROR
    When the error state renders
    Then the alert shows "Couldn't load trace [<trace_id>]"

  Scenario: retry button remains visible but disabled during refetch
    Given the trace query has errored
    When the user clicks the retry button and refetch is in progress
    Then the button remains rendered with disabled state
    And the button shows a loading indicator

  Scenario: retry button passes context to error handler
    Given the trace query has errored
    When the user clicks the retry button and it fails
    Then easyCatchToast receives the error with context "TraceMessage refetch"
