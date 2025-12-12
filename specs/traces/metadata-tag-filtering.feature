Feature: Metadata tag filtering in traces panel
  As a user viewing trace details
  I want to click on metadata tags to filter traces
  So that I can quickly find related traces by metadata value

  # E2E: Happy path demonstrating user interaction with real UI

  @e2e
  Scenario: Clicking metadata tag filters traces
    Given I am viewing a trace with user_id "user-123"
    When I click the "user_id" metadata tag
    Then the URL updates with the filter "user_id=user-123"
    And the traces panel refreshes to show filtered results

  # Unit: Pure logic for building filter params

  @unit
  Scenario: Reserved metadata keys map to URL params
    Given a reserved metadata key "user_id" with value "user-123"
    When I build filter params
    Then the result contains { user_id: "user-123" }

  @unit
  Scenario: trace_id uses query search syntax
    Given metadata key "trace_id" with value "abc123"
    When I build filter params
    Then the result contains { query: "trace_id:abc123" }

  @unit
  Scenario: Array metadata values pass all elements for OR filtering
    Given metadata key "labels" with array value ["foo", "bar"]
    When I build filter params
    Then the result contains { labels: "foo,bar" }

  @unit
  Scenario: Custom metadata keys use metadata prefix
    Given a custom metadata key "environment" with value "prod"
    When I build filter params
    Then the result contains { metadata_key: "environment", "metadata.environment": "prod" }

  @unit
  Scenario: Dots in custom keys are replaced with middle dots
    Given a custom metadata key "app.version" with value "1.0"
    When I build filter params
    Then the result contains { metadata_key: "app·version", "metadata.app·version": "1.0" }
