Feature: The refusal-is-a-handled-error lint rule
  A refusal carries a stable code, so it is a thrown HandledError and never a
  result the caller unwraps and renders again. This rule owns the
  `{ ok: false, status, body }` result shape; a REST handler that builds its
  own answer is rest-route's `manualAnswer`, reported there once.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A refusal carries a code the client can key on
    Given a process file returning `{ ok: false, status: 401, body }`
    When the refusal-is-a-handled-error rule runs over it
    Then it reports handWrittenRefusal on that object, naming the `ok: false` shape

  @unit
  Scenario: A success result or a thrown error is not a refusal
    Given a process file answering a success, throwing a named error, or holding `{ ok: true, status: 200, body }`
    When the refusal-is-a-handled-error rule runs over it
    Then it reports nothing

  @unit
  Scenario: A hand-built REST answer is left to rest-route
    Given a REST transport answering `c.json({ error }, 401)`
    When the refusal-is-a-handled-error rule runs over it
    Then it reports nothing
