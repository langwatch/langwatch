Feature: Trace metadata display in Tags UI
  As a user viewing trace details
  I want to see all metadata attached to a trace displayed as tags
  So that I can quickly understand the context of each trace

  # E2E: Full system happy path - user sees metadata tags on a real trace

  @e2e
  Scenario: User views trace with both reserved and custom metadata
    Given a trace exists with user_id "user-42" and custom metadata key "environment" with value "production"
    When I open the trace detail view
    Then I see a metadata tag "trace_id" with the trace's ID
    And I see a metadata tag "user_id" with value "user-42"
    And I see a metadata tag "environment" with value "production"

  # Integration: Edge cases for rendering different metadata value types
  # These test the Summary component's value-to-display-string logic with mocked trace data

  @integration
  Scenario: Displays string custom metadata as a tag
    Given a trace with custom metadata key "region" and string value "us-east-1"
    When the trace summary renders
    Then a metadata tag appears with label "region" and value "us-east-1"

  @integration
  Scenario: Displays numeric custom metadata as a tag
    Given a trace with custom metadata key "retry_count" and numeric value 3
    When the trace summary renders
    Then a metadata tag appears with label "retry_count" and value "3"

  @integration
  Scenario: Displays boolean custom metadata as a tag
    Given a trace with custom metadata key "is_test" and boolean value true
    When the trace summary renders
    Then a metadata tag appears with label "is_test" and value "true"

  @integration
  Scenario: Displays array metadata as comma-separated values
    Given a trace with metadata key "labels" and array value ["urgent", "billing"]
    When the trace summary renders
    Then a metadata tag appears with label "labels" and value "urgent, billing"

  @integration
  Scenario: Hides tag for empty array metadata
    Given a trace with metadata key "labels" and an empty array value
    When the trace summary renders
    Then no metadata tag appears for "labels"

  @integration
  Scenario: Displays nested object metadata as JSON string
    Given a trace with custom metadata key "config" and object value {"model": "gpt-4", "temp": 0.7}
    When the trace summary renders
    Then a metadata tag appears with label "config" and a JSON-stringified value

  @integration
  Scenario: Displays empty string metadata with escaped quotes
    Given a trace with custom metadata key "notes" and empty string value ""
    When the trace summary renders
    Then a metadata tag appears with label "notes" and value '""'

  @integration
  Scenario: Hides tag when metadata value is null
    Given a trace with reserved metadata key "thread_id" and null value
    When the trace summary renders
    Then no metadata tag appears for "thread_id"

  @integration
  Scenario: Hides tag when metadata value is undefined
    Given a trace with reserved metadata key "customer_id" that is not set
    When the trace summary renders
    Then no metadata tag appears for "customer_id"

  @integration
  Scenario: Always displays trace_id as first tag
    Given a trace with trace_id "trace-abc-123"
    When the trace summary renders
    Then the first metadata tag has label "trace_id" and value "trace-abc-123"

  # Unit: Pure transformation logic - ES document to Trace metadata flattening

  @unit
  Scenario: Transformer extracts reserved metadata from ES document
    Given an ES trace document with metadata containing thread_id "thread-1" and user_id "user-1"
    When the trace is transformed
    Then the resulting trace metadata includes thread_id "thread-1"
    And the resulting trace metadata includes user_id "user-1"

  @unit
  Scenario: Transformer flattens custom metadata from nested structure
    Given an ES trace document with metadata.custom containing key "environment" with value "staging"
    When the trace is transformed
    Then the resulting trace metadata includes "environment" with value "staging"

  @unit
  Scenario: Transformer preserves all custom metadata keys
    Given an ES trace document with metadata.custom containing keys "app_version", "region", and "feature_flag"
    When the trace is transformed
    Then the resulting trace metadata includes all three custom keys

  @unit
  Scenario: Reserved metadata takes precedence over custom metadata with same key
    Given an ES trace document with reserved metadata user_id "reserved-user" and custom metadata user_id "custom-user"
    When the trace is transformed
    Then the resulting trace metadata has user_id "reserved-user"

  @unit
  Scenario: Transformer handles missing custom metadata gracefully
    Given an ES trace document with no metadata.custom field
    When the trace is transformed
    Then the resulting trace metadata contains only reserved fields

  @unit
  Scenario: Transformer handles empty metadata object
    Given an ES trace document with an empty metadata object
    When the trace is transformed
    Then the resulting trace metadata is an empty object
