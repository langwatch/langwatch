Feature: LangWatchQL content gate holds for column-set expressions in every position

  As a LangWatch project member whose data-privacy policy withholds captured input or output
  I want every LangWatchQL query that could resolve to a withheld field to be refused
  So that wrapping a wildcard or COLUMNS() matcher in a function or clause is no easier than naming the field

  Issue: langwatch/langwatch-saas#1244.

  Background:
    Given the LangWatchQL validator runs with a non-empty gated-column set unless a scenario says otherwise

  @unit
  Scenario: A regular-expression column set is refused wherever it appears
    Given a caller with at least one gated column
    When the query places COLUMNS('<regex>') or t.COLUMNS('<regex>') inside a function argument, WHERE, GROUP BY, HAVING, ORDER BY, LIMIT BY, JOIN ON, a window PARTITION BY, a lambda body, a CTE body, a subquery, or a UNION ALL branch
    Then the query is refused with the WILDCARD_NOT_ALLOWED rule
    And the refusal is reported for every one of those positions, not only the projection

  @unit
  Scenario: A wildcard is refused inside functions and in non-projection clauses
    Given a caller with at least one gated column
    When the query uses *, t.*, * EXCEPT (...), or * REPLACE (...) inside tuple, tupleElement, toString, or concat, or bare in GROUP BY or ORDER BY
    Then the query is refused with the WILDCARD_NOT_ALLOWED rule

  @unit
  Scenario: Only a bare star as the sole argument of count stays exempt
    Given a caller with at least one gated column
    When the query is SELECT count(*) or SELECT count()
    Then the query is accepted
    When the query instead uses count(t.*), count(DISTINCT *), count(* EXCEPT (TraceId)), count(*, TraceId), sum(*), or tuple(*)
    Then each of those is refused with the WILDCARD_NOT_ALLOWED rule

  @unit
  Scenario: A caller with nothing withheld keeps every column-set shape
    Given a caller whose gated-column set is empty
    When the query uses any column-set shape from the two refusal scenarios above
    Then the query is accepted

  @unit
  Scenario: A qualified path through a gated column is refused
    Given a caller for whom CapturedInput is gated
    When the query names CapturedInput.null or traces.CapturedInput.null
    Then the query is refused with the GATED_COLUMN rule

  @integration
  Scenario: The reported query is refused before it reaches the shipped views
    Given the shipped analytics views provisioned over the fact tables
    And the restricted query identity with captured input and output withheld
    When the caller submits SELECT TraceId, toString(COLUMNS('^CapturedInput$')) AS leaked FROM traces LIMIT 10
    Then the validator refuses it with the WILDCARD_NOT_ALLOWED rule
    And each column-set shape added to the gated-position matrix is refused the same way
    And the same query submitted directly to the database as that identity would return the captured input, which is why the validator is the gate

  # Verified by manual use-proof against the running app: HTTP 400
  # lwql_not_permitted / WILDCARD_NOT_ALLOWED.
  @e2e @unimplemented
  Scenario: A content-withheld caller gets a rule-named refusal from the running API
    Given a running LangWatch app and a caller whose policy withholds captured input
    When the caller runs the reported query through the LangWatchQL API
    Then the response includes a violation whose code is WILDCARD_NOT_ALLOWED
    And it is not a ClickHouse error
    And a caller holding the content permission gets rows from the same query

# --- AC Coverage Map ---
# AC 1: "COLUMNS matcher refused in every position" → Scenario: A regular-expression column set is refused wherever it appears
# AC 2: "wildcard refused inside function arguments and non-projection clauses" → Scenario: A wildcard is refused inside functions and in non-projection clauses
# AC 3: "count(*) and count() stay accepted; every other star use refused" → Scenario: Only a bare star as the sole argument of count stays exempt
# AC 4: "empty gated set accepts every shape" → Scenario: A caller with nothing withheld keeps every column-set shape
# AC 5: "qualified path through a gated column refused" → Scenario: A qualified path through a gated column is refused
# AC 6: "reported query refused against the shipped views; matrix extended" → Scenario: The reported query is refused before it reaches the shipped views
# AC 7: "existing suites unchanged" → verified by running the existing suites in the PR
# AC 8: "running API returns a rule-named refusal" → Scenario: A content-withheld caller gets a rule-named refusal from the running API (@unimplemented, verified by manual use-proof against the running app)
