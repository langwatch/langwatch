Feature: Online Evaluation Preconditions Renewal
  As a user configuring online evaluations
  I want powerful preconditions using the same filters available across LangWatch
  So that evaluations only run on relevant traces

  Background:
    Given I am logged in to a project
    And I have at least one evaluator created

  # ── Data Flow ──────────────────────────────
  # Preconditions are evaluated IN MEMORY when a trace arrives, before
  # any evaluation is scheduled. The data available at that point:
  #
  # | Field               | Source at evaluation time                          |
  # |---------------------|----------------------------------------------------|
  # | input / output      | trace.input.value / trace.output.value             |
  # | traces.origin       | trace attributes: langwatch.origin (empty = app)   |
  # | traces.error        | trace.error (ErrorCapture | null → boolean)        |
  # | metadata.labels     | trace.metadata.labels (string[])                   |
  # | metadata.user_id    | trace.metadata.user_id (string)                    |
  # | metadata.thread_id  | trace.metadata.thread_id (string)                  |
  # | metadata.customer_id| trace.metadata.customer_id (string)                |
  # | metadata.prompt_ids | trace.metadata.prompt_ids (string[])               |
  # | spans.type          | spans[].type — ANY semantics (match if any span)   |
  # | spans.model         | spans[].model — ANY semantics (match if any span)  |
  #
  # Fields NOT available as preconditions (computed after trace arrival):
  # topics.*, evaluations.*, events.*, annotations.*, sentiment.*
  #
  # Implementation note: PreconditionTrace type and executeEvaluation
  # command data schema must be expanded to include origin, error,
  # and metadata fields not currently passed through.

  # ────────────────────────────────────────────
  # Precondition Field Expansion
  # ────────────────────────────────────────────

  @unit
  Scenario: Precondition field registry includes all trace-time filters
    Given the precondition field configuration
    Then the following fields are defined:
      | field               | category |
      | input               | Trace    |
      | output              | Trace    |
      | traces.origin       | Trace    |
      | traces.error        | Trace    |
      | metadata.labels     | Metadata |
      | metadata.user_id    | Metadata |
      | metadata.thread_id  | Metadata |
      | metadata.customer_id| Metadata |
      | metadata.prompt_ids | Metadata |
      | spans.type          | Spans    |
      | spans.model         | Spans    |

  @unit
  Scenario: Available rules depend on field type
    Given the precondition field configuration
    Then text fields (input, output) support rules: contains, not_contains, matches_regex, is
    And enum fields (traces.origin) support rules: is
    And boolean fields (traces.error) support rules: is
    And string metadata fields (user_id, thread_id, customer_id) support rules: contains, not_contains, matches_regex, is
    And span lookup fields (spans.model, spans.type) support rules: is
    And array fields (metadata.labels, metadata.prompt_ids) support rules: is, contains, not_contains

  @integration
  Scenario: Boolean field shows true/false selector instead of text input
    Given the online evaluation drawer is open with evaluator selected
    When I add a precondition and select field "traces.error"
    Then the value input is replaced by a true/false selector

  # ────────────────────────────────────────────
  # Default Origin Precondition
  # ────────────────────────────────────────────

  @integration
  Scenario: New evaluator includes default origin precondition
    Given the online evaluation drawer is open
    When I select an evaluator
    Then the preconditions list includes a default entry:
      | field         | rule | value       |
      | traces.origin | is   | application |

  @integration
  Scenario: Migration adds origin precondition to ALL existing evaluators
    Given existing monitors in the database
    When the migration runs
    Then monitors with empty or null preconditions get:
      | field         | rule | value       |
      | traces.origin | is   | application |
    And monitors with existing preconditions get origin=application prepended:
      # e.g. [{field: "input", rule: "contains", value: "hello"}]
      # becomes [{field: "traces.origin", rule: "is", value: "application"},
      #          {field: "input", rule: "contains", value: "hello"}]
    # This ensures consistent behavior: all monitors filter to application
    # traces by default, whether created before or after this change.

  # ────────────────────────────────────────────
  # Collapsed / Expanded UI State
  # ────────────────────────────────────────────

  @integration
  Scenario: Default-only precondition shows collapsed summary
    Given an online evaluator with only the default origin=application precondition
    When I view the preconditions section
    Then I see the text "This evaluation will run on every application trace"
    And I do not see the precondition form fields
    And I see an "Add precondition" button

  @integration
  Scenario: Clicking add precondition expands the form
    Given the preconditions section is in collapsed state
    When I click "Add precondition"
    Then the precondition form fields are shown
    And the existing origin=application precondition is visible as a row
    And a new empty precondition row is added for me to fill in

  @integration
  Scenario: Multiple preconditions always show expanded form
    Given an online evaluator with preconditions:
      | field         | rule     | value       |
      | traces.origin | is       | application |
      | input         | contains | hello       |
    When I view the preconditions section
    Then I see the precondition form fields (expanded state)
    And I do not see the collapsed summary text

  @integration
  Scenario: Removing all custom preconditions collapses back to summary
    Given an evaluator with preconditions:
      | field         | rule     | value       |
      | traces.origin | is       | application |
      | input         | contains | hello       |
    When I remove the "input contains hello" precondition
    Then only the default origin=application precondition remains
    And the section collapses to show "This evaluation will run on every application trace"

  @integration
  Scenario: User can change origin precondition value
    Given an evaluator with the default origin=application precondition
    When the user expands the form and changes origin value to "simulation"
    Then the summary updates and no longer shows the collapsed text
    And the precondition is traces.origin is "simulation"

  @integration
  Scenario: User can remove the origin precondition when other preconditions exist
    Given an evaluator with preconditions:
      | field         | rule     | value       |
      | traces.origin | is       | application |
      | input         | contains | hello       |
    When I remove the origin=application precondition
    Then the evaluator has only the input precondition
    And the evaluation will run on traces from any origin matching "hello"

  # ────────────────────────────────────────────
  # Precondition Matching: "is" rule (exact match)
  # ────────────────────────────────────────────

  @unit
  Scenario: Origin "is" application matches traces with empty or absent origin
    # "application" is a sentinel: traces with no explicit origin ARE application traces
    Given a precondition: traces.origin is "application"
    When a trace arrives with no langwatch.origin attribute
    Then the precondition passes
    When a trace arrives with langwatch.origin = ""
    Then the precondition passes
    When a trace arrives with langwatch.origin = "evaluation"
    Then the precondition fails

  @unit
  Scenario: Origin "is" matches non-application origins exactly
    Given a precondition: traces.origin is "simulation"
    When a trace arrives with langwatch.origin = "simulation"
    Then the precondition passes
    When a trace arrives with no langwatch.origin attribute
    Then the precondition fails
    When a trace arrives with langwatch.origin = "playground"
    Then the precondition fails

  @unit
  Scenario: "is" rule on text fields does case-insensitive exact match
    Given a precondition: input is "Hello World"
    When a trace arrives with input "hello world"
    Then the precondition passes
    When a trace arrives with input "Hello World!"
    Then the precondition fails

  @unit
  Scenario: "is" rule on array fields matches if value is in array
    Given a precondition: metadata.labels is "production"
    When a trace arrives with labels ["production", "api"]
    Then the precondition passes
    When a trace arrives with labels ["staging"]
    Then the precondition fails

  @unit
  Scenario: "is" on metadata.prompt_ids matches if prompt id is present
    Given a precondition: metadata.prompt_ids is "prompt_1"
    When a trace arrives with prompt_ids ["prompt_1", "prompt_2"]
    Then the precondition passes
    When a trace arrives with prompt_ids ["prompt_3"]
    Then the precondition fails

  # ────────────────────────────────────────────
  # Precondition Matching: Span fields (ANY semantics)
  # ────────────────────────────────────────────

  @unit
  Scenario: "is" on spans.model matches if ANY span in the trace has that model
    Given a precondition: spans.model is "gpt-4"
    When a trace arrives with spans [llm(model="gpt-4"), llm(model="gpt-3.5")]
    Then the precondition passes
    When a trace arrives with spans [llm(model="claude-3")]
    Then the precondition fails
    When a trace arrives with spans [tool(no model), llm(model="gpt-4")]
    Then the precondition passes

  @unit
  Scenario: "is" on spans.type matches if ANY span in the trace has that type
    Given a precondition: spans.type is "rag"
    When a trace arrives with spans of types ["llm", "rag"]
    Then the precondition passes
    When a trace arrives with spans of types ["llm", "tool"]
    Then the precondition fails

  # ────────────────────────────────────────────
  # Precondition Matching: Error field
  # ────────────────────────────────────────────

  @unit
  Scenario: "is" on traces.error matches presence of error
    # traces.error is derived from trace.error (ErrorCapture | null)
    # User provides "true" or "false" as value
    Given a precondition: traces.error is "true"
    When a trace arrives with error { has_error: true, message: "fail" }
    Then the precondition passes
    When a trace arrives with error null
    Then the precondition fails

  @unit
  Scenario: traces.error "false" matches traces without errors
    Given a precondition: traces.error is "false"
    When a trace arrives with error null
    Then the precondition passes
    When a trace arrives with error { has_error: true, message: "fail" }
    Then the precondition fails

  # ────────────────────────────────────────────
  # Precondition Matching: Metadata string fields
  # ────────────────────────────────────────────

  @unit
  Scenario: "contains" on metadata.user_id checks substring
    Given a precondition: metadata.user_id contains "admin"
    When a trace arrives with user_id "admin_123"
    Then the precondition passes
    When a trace arrives with user_id "guest_456"
    Then the precondition fails

  @unit
  Scenario: "is" on metadata.user_id checks exact match
    Given a precondition: metadata.user_id is "user_42"
    When a trace arrives with user_id "user_42"
    Then the precondition passes
    When a trace arrives with user_id "user_421"
    Then the precondition fails

  @unit
  Scenario: "is" on metadata.thread_id matches exact thread
    Given a precondition: metadata.thread_id is "thread_abc"
    When a trace arrives with thread_id "thread_abc"
    Then the precondition passes
    When a trace arrives with thread_id "thread_xyz"
    Then the precondition fails

  @unit
  Scenario: "is" on metadata.customer_id matches exact customer
    Given a precondition: metadata.customer_id is "cust_99"
    When a trace arrives with customer_id "cust_99"
    Then the precondition passes
    When a trace arrives with customer_id "cust_100"
    Then the precondition fails

  @unit
  Scenario: "not_contains" on metadata.customer_id excludes matching
    Given a precondition: metadata.customer_id not_contains "test"
    When a trace arrives with customer_id "test_user"
    Then the precondition fails
    When a trace arrives with customer_id "prod_user"
    Then the precondition passes

  @unit
  Scenario: "matches_regex" on metadata.user_id matches pattern
    Given a precondition: metadata.user_id matches_regex "^admin_\d+"
    When a trace arrives with user_id "admin_42"
    Then the precondition passes
    When a trace arrives with user_id "user_admin_42"
    Then the precondition fails

  # ────────────────────────────────────────────
  # Precondition Matching: Multiple preconditions (AND logic)
  # ────────────────────────────────────────────

  @unit
  Scenario: All preconditions must pass (AND logic)
    Given preconditions:
      | field         | rule     | value       |
      | traces.origin | is       | application |
      | input         | contains | help        |
    When a trace arrives with no origin and input "I need help"
    Then the evaluation runs
    When a trace arrives with origin "simulation" and input "I need help"
    Then the evaluation is skipped
    When a trace arrives with no origin and input "goodbye"
    Then the evaluation is skipped

  # ────────────────────────────────────────────
  # Precondition Matching: Missing/null field values
  # ────────────────────────────────────────────

  @unit
  Scenario: Missing metadata fields fail "is" and "contains" checks
    Given a precondition: metadata.user_id is "admin"
    When a trace arrives with no user_id set (null/undefined)
    Then the precondition fails

  @unit
  Scenario: Missing metadata fields pass "not_contains" checks
    Given a precondition: metadata.user_id not_contains "admin"
    When a trace arrives with no user_id set (null/undefined)
    Then the precondition passes

  # ────────────────────────────────────────────
  # Backward Compatibility
  # ────────────────────────────────────────────

  @unit
  Scenario: Existing preconditions with old fields still work
    Given a monitor with legacy preconditions:
      | field           | rule         | value      |
      | input           | contains     | customer   |
      | output          | not_contains | error      |
      | metadata.labels | contains     | production |
    When traces arrive matching the legacy rules
    Then the preconditions evaluate identically to the old behavior

  # ────────────────────────────────────────────
  # API Schema
  # ────────────────────────────────────────────

  @integration
  Scenario: Create monitor with expanded preconditions via API
    When I create a monitor with preconditions:
      | field         | rule | value       |
      | traces.origin | is   | application |
      | spans.model   | is   | gpt-4       |
    Then the monitor is saved successfully
    And the preconditions are persisted correctly

  @integration
  Scenario: Update monitor preconditions via API
    Given an existing monitor with default preconditions
    When I update the monitor adding:
      | field            | rule     | value  |
      | metadata.user_id | contains | admin  |
    Then the monitor is updated successfully
    And all preconditions are persisted

  @integration
  Scenario: API rejects invalid precondition fields
    When I create a monitor with preconditions:
      | field                | rule | value |
      | evaluations.passed   | is   | true  |
    Then the API returns a validation error
    Because evaluation fields are not available at trace arrival time

  @integration
  Scenario: API rejects invalid rule for field type
    When I create a monitor with preconditions:
      | field         | rule     | value       |
      | traces.origin | contains | application |
    Then the API returns a validation error
    Because traces.origin only supports the "is" rule

  # ────────────────────────────────────────────
  # Frontend Integration Tests (RTL)
  # ────────────────────────────────────────────

  @integration
  Scenario: Precondition field selector shows categorized options
    Given the online evaluation drawer is open with evaluator selected
    When I click the precondition field dropdown
    Then I see fields grouped by category (Trace, Metadata, Spans)
    And each field shows a human-readable label

  @integration
  Scenario: Selecting a field updates available rules
    Given I am adding a precondition
    When I select field "input"
    Then rules "contains", "not_contains", "matches_regex", "is" are available
    When I select field "traces.origin"
    Then only rule "is" is available
    When I select field "spans.model"
    Then only rule "is" is available

  @integration
  Scenario: Value input is free text for all fields
    Given I am adding a precondition with field "spans.model"
    Then the value input is a free text field
    And I can type "gpt-4" directly
