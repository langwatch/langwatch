Feature: Online Evaluation Preconditions Renewal
  As a user configuring online evaluations
  I want powerful preconditions using the same filters available across LangWatch
  So that evaluations only run on relevant traces

  Background:
    Given I am logged in to a project
    And I have at least one evaluator created

  # ── Design Principle ──────────────────────────
  # Preconditions REUSE the existing filter registry (FilterField enum).
  # No separate handcoded field config — the filter registry IS the source
  # of truth for available fields, their names, and nested key requirements.
  #
  # Two additional fields ("input", "output") are precondition-only since
  # they represent trace-level text that isn't a filter field.
  #
  # Each filter field gets an in-memory `matchTrace` function so preconditions
  # can be evaluated when a trace arrives, without querying ClickHouse/ES.
  #
  # Precondition schema:
  #   { field: string, rule: "is"|"contains"|"not_contains"|"matches_regex",
  #     value: string, key?: string, subkey?: string }
  #
  # `key` is used for nested filters like metadata.value (key=metadata key name)
  # `subkey` is for double-nested filters like events.metrics.value

  # ────────────────────────────────────────────
  # Precondition Field Registry (derived from filters)
  # ────────────────────────────────────────────

  @unit
  Scenario: All filter fields plus input/output are available as precondition fields
    Given the filter registry defines these fields:
      | topics.topics | topics.subtopics | metadata.user_id | metadata.thread_id |
      | metadata.customer_id | metadata.labels | metadata.key | metadata.value |
      | metadata.prompt_ids | traces.origin | traces.error | spans.type |
      | spans.model | evaluations.evaluator_id | evaluations.evaluator_id.guardrails_only |
      | evaluations.passed | evaluations.score | evaluations.state | evaluations.label |
      | events.event_type | events.metrics.key | events.metrics.value |
      | events.event_details.key | annotations.hasAnnotation | sentiment.input_sentiment |
    Then preconditions accept all filter fields plus "input" and "output"
    And each field uses the registry name as its label

  @unit
  Scenario: Allowed rules derive from field characteristics
    Then text-like fields (input, output, metadata.user_id, metadata.thread_id, etc) support: is, contains, not_contains, matches_regex
    And boolean fields (traces.error, annotations.hasAnnotation) support: is
    And enum-like fields (traces.origin, spans.type, spans.model) support: is
    And array fields (metadata.labels, metadata.prompt_ids) support: is, contains, not_contains
    And keyed filters (metadata.value) require a key and support: is, contains, not_contains, matches_regex

  # ────────────────────────────────────────────
  # In-Memory Trace Matching
  # ────────────────────────────────────────────

  @unit
  Scenario: Origin "is" application matches only explicit application origin
    Given a precondition: traces.origin is "application"
    When a trace arrives with langwatch.origin = "application"
    Then the precondition passes
    When a trace arrives with no langwatch.origin attribute
    Then the precondition fails
    When a trace arrives with langwatch.origin = ""
    Then the precondition fails
    When a trace arrives with langwatch.origin = "evaluation"
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
  Scenario: "is" on spans.model matches if ANY span has that model
    Given a precondition: spans.model is "gpt-4"
    When a trace arrives with spans [llm(model="gpt-4"), llm(model="gpt-3.5")]
    Then the precondition passes
    When a trace arrives with spans [llm(model="claude-3")]
    Then the precondition fails

  @unit
  Scenario: "is" on traces.error matches error presence
    Given a precondition: traces.error is "true"
    When a trace arrives with error present
    Then the precondition passes
    When a trace arrives with error null
    Then the precondition fails

  @unit
  Scenario: Nested key filter - metadata.value with key
    Given a precondition: metadata.value key="environment" is "production"
    When a trace arrives with custom metadata { environment: "production" }
    Then the precondition passes
    When a trace arrives with custom metadata { environment: "staging" }
    Then the precondition fails
    When a trace arrives with no "environment" metadata
    Then the precondition fails

  @unit
  Scenario: Nested key filter - metadata.value with contains rule
    Given a precondition: metadata.value key="deployment_tag" contains "canary"
    When a trace arrives with custom metadata { deployment_tag: "canary-v2" }
    Then the precondition passes
    When a trace arrives with custom metadata { deployment_tag: "stable-v1" }
    Then the precondition fails

  @unit
  Scenario: Topics filter matches topic ID
    Given a precondition: topics.topics is "billing"
    When a trace arrives with topic_id "billing"
    Then the precondition passes
    When a trace arrives with topic_id "support"
    Then the precondition fails
    When a trace arrives with no topic assigned
    Then the precondition fails

  @unit
  Scenario: Sentiment filter matches satisfaction score ranges
    Given a precondition: sentiment.input_sentiment is "positive"
    When a trace arrives with satisfaction_score 0.5
    Then the precondition passes
    When a trace arrives with satisfaction_score -0.5
    Then the precondition fails

  @unit
  Scenario: All preconditions must pass (AND logic)
    Given preconditions:
      | field         | rule     | value       |
      | traces.origin | is       | application |
      | input         | contains | help        |
    When a trace arrives with origin "application" and input "I need help"
    Then the evaluation runs
    When a trace arrives with no origin and input "I need help"
    Then the evaluation is skipped
    When a trace arrives with origin "simulation" and input "I need help"
    Then the evaluation is skipped

  @unit
  Scenario: Missing field values fail "is" and "contains" checks
    Given a precondition: metadata.user_id is "admin"
    When a trace arrives with no user_id set
    Then the precondition fails

  @unit
  Scenario: Missing field values pass "not_contains" checks
    Given a precondition: metadata.user_id not_contains "admin"
    When a trace arrives with no user_id set
    Then the precondition passes

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
  Scenario: Migration adds origin precondition to ALL existing monitors
    Given existing monitors in the database
    When the migration runs
    Then monitors with empty or null preconditions get origin=application prepended
    And monitors with existing preconditions get origin=application prepended

  # ────────────────────────────────────────────
  # Collapsed / Expanded UI State
  # ────────────────────────────────────────────

  @integration
  Scenario: Default-only precondition shows collapsed summary
    Given an online evaluator with only the default origin=application precondition
    When I view the preconditions section
    Then I see the text "This evaluation will run on every application trace"
    And I see an "Add precondition" button

  @integration
  Scenario: Clicking add precondition expands the form
    Given the preconditions section is in collapsed state
    When I click "Add precondition"
    Then the precondition form fields are shown
    And a new empty precondition row is added

  @integration
  Scenario: Multiple preconditions always show expanded form
    Given an online evaluator with preconditions:
      | field         | rule     | value       |
      | traces.origin | is       | application |
      | input         | contains | hello       |
    When I view the preconditions section
    Then I see the precondition form fields (expanded state)

  # ────────────────────────────────────────────
  # Event Sourcing Pipeline Data Flow
  # ────────────────────────────────────────────

  @unit
  Scenario: Evaluation trigger passes all trace attributes for precondition matching
    Given a trace arrives via event sourcing
    Then the executeEvaluation command includes all trace summary data needed for precondition evaluation
    And custom metadata from span attributes is available for matching

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
