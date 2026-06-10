@integration
Feature: Trace search projection DSL
  As an API consumer building an ETL pipeline
  I want to declare which fields to return from POST /api/traces/search
  So that I get exactly the data I need in one paginated loop without per-trace fan-out

  # Track 1 / M1 of the API Export Traces RFC.
  # Extends POST /api/traces/search with two new optional attributes:
  #   from: "traces"  (entity root — only "traces" at launch)
  #   select: ["trace_id", "metadata.user_id", "events.type", ...]
  # When both are absent, behavior is unchanged (backwards compatible).
  # When select is present, response includes a "schema" field and
  # only the projected columns are returned per trace.

  Background:
    Given I am authenticated with a project API key that has traces:view permission
    And my project has traces with metadata, events, annotations, and evaluations

  # ==========================================================================
  # Backwards compatibility
  # ==========================================================================

  Scenario: Request without from or select returns the current response shape
    When I POST /api/traces/search with only startDate, endDate, and pageSize
    Then the response status is 200
    And the response body has "traces" array and "pagination" object
    And no "schema" field is present in the response
    And each trace contains the full default fields

  # ==========================================================================
  # Basic projection — cheap same-store fields
  # ==========================================================================

  Scenario: Select trace-level scalar fields
    When I POST /api/traces/search with from "traces" and select ["trace_id", "started_at"]
    Then the response status is 200
    And each trace contains only "trace_id" and "started_at"
    And the response includes a "schema" field listing the resolved columns

  Scenario: Select metadata fields grouped into a metadata object
    When I POST /api/traces/search with from "traces" and select ["trace_id", "metadata.user_id", "metadata.customer_id"]
    Then each trace contains "trace_id" and a "metadata" object
    And the metadata object contains only "user_id" and "customer_id"

  Scenario: Select metrics fields
    When I POST /api/traces/search with from "traces" and select ["trace_id", "metrics.total_cost", "metrics.prompt_tokens"]
    Then each trace contains "trace_id" and a "metrics" object
    And the metrics object contains only "total_cost" and "prompt_tokens"

  # ==========================================================================
  # Evaluations projection
  # ==========================================================================

  Scenario: Select evaluation fields returned as nested array
    When I POST /api/traces/search with from "traces" and select ["trace_id", "evaluations.name", "evaluations.score", "evaluations.passed"]
    Then each trace contains "trace_id" and an "evaluations" array
    And each evaluation object contains only "name", "score", and "passed"

  # ==========================================================================
  # Events projection — bounded stored_spans sub-query
  # ==========================================================================

  Scenario: Select event fields returned as nested array
    When I POST /api/traces/search with from "traces" and select ["trace_id", "events.type", "events.metrics", "events.timestamp"]
    Then each trace contains "trace_id" and an "events" array
    And each event object contains only "type", "metrics", and "timestamp"

  # ==========================================================================
  # Annotations projection — cross-store Postgres join
  # ==========================================================================

  Scenario: Select annotation fields returned as nested array
    When I POST /api/traces/search with from "traces" and select ["trace_id", "annotations.is_thumbs_up", "annotations.score", "annotations.comment"]
    Then each trace contains "trace_id" and an "annotations" array
    And each annotation object contains only "is_thumbs_up", "score", and "comment"

  # ==========================================================================
  # Mixed projection — all sources in one request
  # ==========================================================================

  Scenario: Select fields from all sources in a single request
    When I POST /api/traces/search with from "traces" and select ["trace_id", "started_at", "metadata.user_id", "metrics.total_cost", "evaluations.score", "events.type", "annotations.is_thumbs_up"]
    Then each trace contains "trace_id", "started_at", "metadata", "metrics", "evaluations", "events", and "annotations"
    And child collections are nested arrays, scalar groups are objects

  # ==========================================================================
  # Schema field in response
  # ==========================================================================

  Scenario: Response includes schema when select is present
    When I POST /api/traces/search with from "traces" and select ["trace_id", "metadata.user_id", "evaluations.score"]
    Then the response includes a "schema" field
    And the schema lists the resolved column names and their types

  # ==========================================================================
  # Validation — unknown and invalid paths
  # ==========================================================================

  Scenario: Unknown select path returns 400
    When I POST /api/traces/search with from "traces" and select ["trace_id", "nonexistent_field"]
    Then the response status is 400
    And the error message identifies "nonexistent_field" as an invalid path

  Scenario: Unknown from entity returns 400
    When I POST /api/traces/search with from "sessions" and select ["trace_id"]
    Then the response status is 400
    And the error message identifies "sessions" as an unsupported entity

  Scenario: Empty select array returns 400
    When I POST /api/traces/search with from "traces" and select []
    Then the response status is 400

  Scenario: Select without from defaults to the traces entity root
    When I POST /api/traces/search with select ["trace_id"] and no from field
    Then the response status is 200
    And the traces are projected as if from "traces" had been specified

  # ==========================================================================
  # RBAC protections — io.* fields respect canSeeCapturedInput/Output
  # ==========================================================================

  Scenario: Projected io fields are dropped when user lacks captured-input permission
    Given the API key's role does not permit seeing captured input
    When I POST /api/traces/search with from "traces" and select ["trace_id", "input", "output"]
    Then each trace contains "trace_id"
    And "input" is redacted or null
    And the response does not expose raw captured input

  Scenario: Projected io fields are included when user has full permissions
    Given the API key's role permits seeing captured input and output
    When I POST /api/traces/search with from "traces" and select ["trace_id", "input", "output"]
    Then each trace contains "trace_id", "input", and "output" with actual values

  # ==========================================================================
  # Performance and OOM safety
  # ==========================================================================

  # Tracking: #4716 — deterministic perf/load test not written yet.
  @unimplemented
  Scenario: A projection of only lightweight fields returns quickly on a wide window
    Given my project has tens of thousands of traces in the requested window
    When I POST /api/traces/search with from "traces" and select ["trace_id", "metadata.user_id", "metrics.total_cost"]
    Then the response returns within the 30-second target for a page of up to 1000 rows
    And only the requested lightweight fields appear on each trace

  # Tracking: #4716 — wide-window OOM-safety test needs a large-dataset harness.
  @unimplemented
  Scenario: A wide window with heavy fields stays within memory limits instead of failing
    Given my project has a very large number of traces in the requested window
    When I POST /api/traces/search with from "traces", select ["trace_id", "input", "output"], and pageSize 1000
    Then the request succeeds or returns a bounded error
    And the server does not run out of memory

  # ==========================================================================
  # Pagination — unchanged keyset cursor
  # ==========================================================================

  Scenario: Projection works with keyset cursor pagination
    Given my project has more than 10 matching traces
    When I POST /api/traces/search with from "traces", select ["trace_id", "started_at"], and pageSize 5
    Then the response contains 5 traces and a scrollId
    When I POST again with the same select and the returned scrollId
    Then the response contains the next page of traces with no duplicates

  # ==========================================================================
  # Date axis — query by when a trace was modified, not when it occurred
  # ==========================================================================

  # ETL pipelines need "everything CHANGED since my last pull", not just
  # "everything that STARTED since then". Traces mutate after creation:
  # evaluations arrive later, annotations are added, metadata is patched.
  # A trace can occur 30 days ago and be modified today — an occurrence-based
  # window misses that change entirely. So the date window must be able to
  # apply to the last-modified time instead.
  #
  # The request gains an optional dateField: "occurred" (default) or "updated".
  # It selects which timestamp the existing startDate/endDate window filters.
  # Default "occurred" keeps current behavior; the two axes are mutually
  # exclusive within a single request.

  Scenario: Default date axis is occurrence
    When I POST /api/traces/search with startDate, endDate, and no dateField
    Then the window filters traces by when they occurred
    And the behavior is identical to today's

  Scenario: Updated axis captures a late-mutated old trace
    Given a trace occurred 30 days ago and was last modified today
    When I POST /api/traces/search with dateField "updated" and a window covering only today
    Then the response includes that trace because it was modified today
    And an occurrence-based window covering only today would have excluded it

  Scenario: Updated axis returns everything modified within the window
    When I POST /api/traces/search with dateField "updated", select ["trace_id", "started_at"], and a one-day window
    Then every trace modified within that day is returned regardless of when it occurred

  Scenario: Updated axis pagination is complete and at-least-once
    Given my project has more than one page of traces modified within the window
    When I page through the results using the returned scrollId on the updated axis
    Then no modified trace is missed across pages
    And a trace modified again mid-pagination may reappear on a later page rather than being dropped

  Scenario: Invalid dateField value returns 400
    When I POST /api/traces/search with dateField "created"
    Then the response status is 400
    And the error identifies "created" as an unsupported date axis

  # ==========================================================================
  # Existing filters — unchanged
  # ==========================================================================

  # Tracking: #4716 — projection + filter-compiler combined test not written yet.
  @unimplemented
  Scenario: Projection works alongside existing filters
    When I POST /api/traces/search with from "traces", select ["trace_id", "events.type"], and a label filter for "production"
    Then only traces matching the "production" label are returned
    And each trace is projected to contain only "trace_id" and "events"
