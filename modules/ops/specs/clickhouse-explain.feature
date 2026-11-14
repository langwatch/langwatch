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

  # ADR-202 Decided 14: the api holds no credential that reads every tenant, so the
  # worker runs the EXPLAIN on langwatch_ops and the agent polls the result by its id.

  @unit
  Scenario: An accepted EXPLAIN answers 202 with a request id and runs on the worker
    Given a caller with the operator secret
    When it posts a query the guardrails accept
    Then the door answers 202 {"requestId": "<id>"}
    And one EXPLAIN request is sent on the ops pipeline, carrying the request id and not the query

  @unit
  Scenario: A query the guardrails refuse is answered at once and sends nothing
    Given a caller with the operator secret
    When it posts a query that is not a single SELECT
    Then the door answers 400 {"message": "<reason>"}
    And no EXPLAIN request is sent

  @unit
  Scenario: The result answers pending until the worker stores the rows
    Given an accepted EXPLAIN request
    When the operator tool asks GET /api/ops/clickhouse/explain/<id> before the worker ran it
    Then the door answers 200 {"status": "pending"}
    And after the worker ran it on the ops identity the door answers 200 {"status": "done", "type": "<type>", "rows": [...]}

  @unit
  Scenario: An unknown request id answers 404
    Given a caller with the operator secret
    When it asks for a request id this deployment never accepted
    Then the door answers 404 {"message": "<message>"}

  @unit
  Scenario: An expired result answers 404
    Given an EXPLAIN result stored longer ago than its time to live
    When the operator tool asks for it
    Then the door answers 404 {"message": "<message>"}

  @unit
  Scenario: A worker without the ops identity records a failed result
    Given a worker with no CLICKHOUSE_OPS_URL
    When it runs an accepted EXPLAIN request
    Then it never falls back to another ClickHouse identity
    And the result answers 200 {"status": "failed", "error": {"code": "clickhouse_ops_not_configured", "message": "<message>"}}

  @unit
  Scenario: An EXPLAIN that ClickHouse refuses records a failed result without the engine prose
    Given a worker with the ops identity
    When ClickHouse refuses the EXPLAIN
    Then the result answers 200 {"status": "failed", "error": {"code": "clickhouse_explain_refused", "message": "ClickHouse refused the EXPLAIN"}}

  @unit
  Scenario: A redelivered EXPLAIN request stores its rows once
    Given an EXPLAIN request the worker already answered
    When the request is delivered again
    Then ClickHouse is not asked again and the stored rows stay as they are

  @unit
  Scenario: The api role opens no ops ClickHouse client
    Given CLICKHOUSE_OPS_URL is set in the api's environment
    When the api role builds ops
    Then it opens no client for the ops identity, and only the worker does
