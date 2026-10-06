Feature: Operator EXPLAIN behind the operator secret
  The clickhouse-optimizer agent posts to /api/ops/clickhouse/explain with the
  deployment's LANGWATCH_OPS_API_KEY as a bearer. The door compares it before the
  body is read, and every refusal keeps main's 401 {"message":"Unauthorized"}.

  @unit
  Scenario: The operator EXPLAIN door refuses a caller without the secret before the body
    Given a deployment that configured an operator secret
    When a caller presents no secret with a body that is not JSON, or one that fails the schema
    Then the door answers 401 {"message":"Unauthorized"} before the body is read

  @unit
  Scenario: A wrong operator secret is refused with main's 401
    Given a deployment that configured an operator secret
    When a caller presents a different secret
    Then the door answers 401 {"message":"Unauthorized"}

  @unit
  Scenario: A deployment without an operator secret refuses every call with main's 401
    Given a deployment that configured no operator secret, or a blank one
    When a caller presents nothing, or a blank bearer
    Then the door answers 401 {"message":"Unauthorized"}

  @unit
  Scenario: A caller with the operator secret has the body judged
    Given a deployment that configured an operator secret
    When the caller presents it with a body that is not JSON, or one missing the query
    Then a body that is not JSON answers 400 {"message":"request body must be JSON"}
    And a body missing the query answers 422 with a message naming the query field
