Feature: A legacy trace read failure degrades to the generic unknown

  `GET /api/trace/{id}` and `GET /api/traces/{traceId}` read the same trace out
  of the same process. On the same unanticipated failure the second answered
  the generic unknown and the first rendered the failure itself — the internal
  message, the absolute source paths and the stack frames, in the response body
  a customer reads.

  The rule from `dev/docs/best_practices/error-handling.md`: a failure we did
  not anticipate is never described to the caller. It degrades to the generic
  unknown plus the request's trace id, and the detail lives in the log line.

  Finding F4 of `dev/docs/plans/e2e-walk-2026-09-04.md`.

  @integration
  Scenario: An unanticipated legacy trace read failure answers the generic unknown
    Given a legacy single-trace read that fails for a reason nobody anticipated
    When a caller asks for that trace
    Then the answer carries no internal message, source path or stack frame
    And the answer is the same generic body the successor route answers

  @integration
  Scenario: An anonymous legacy trace read is refused rather than failing
    Given the deprecated trace family installed on the trace application
    When a caller asks for a trace or a thread with no credential, or one nothing resolves
    Then the answer is the project door's handled refusal code, not an unknown failure

  @integration
  Scenario: A credentialled legacy trace read reaches the read
    Given a caller whose project credential resolves
    When it asks for a trace that is not there
    Then the read runs and the answer is that family's own not-found

  @integration
  Scenario: A malformed legacy search body earns the sentence the family writes
    Given a caller whose project credential resolves
    When it posts a search body the family's own schema rejects
    Then the answer names the offending field rather than an unknown failure

  @integration
  Scenario: A legacy digest read answers the rendered digest
    Given a caller whose project credential resolves
    When it asks the legacy trace route for a trace in the digest format
    Then formatted_trace carries the rendered digest text, not an empty object
