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
