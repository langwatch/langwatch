Feature: One request leaves one request-log record

  The API process mounts its REST families side by side, and twenty-one of them
  share the `/api` base path. Every family installs the request logger on its
  own mount, so every one of those middlewares matched `/api/prompts` and the
  process wrote up to twenty-one identical `request handled` lines for a single
  request — same trace id, same millisecond, a different span each time. It made
  the log unreadable and multiplied log volume by an order of magnitude.

  The record belongs to the request, not to the mount. Whichever family's logger
  runs first owns it; the rest stand down. The family and the endpoint that
  actually answered are stamped by the route that matched, so the one surviving
  line still says which endpoint the request resolved to rather than naming
  whichever family happened to be mounted first.

  Finding F5 of `dev/docs/plans/e2e-walk-2026-09-04.md`.

  @integration
  Scenario: One request writes one request-log record
    Given three REST families are mounted at the same base path
    When one request arrives for a route one of them owns
    Then exactly one request-log record is written

  @integration
  Scenario: The request-log record names the endpoint that answered
    Given three REST families are mounted at the same base path
    When one request arrives for a route one of them owns
    Then the record names the family and the endpoint that resolved it
    And the record still carries the path, the status and the duration
