@trace @rest
Feature: Updating a trace's metadata after it was sent
  As a developer with an API key
  I want to add or change metadata on a trace that has already been sent
  So that labels and identifiers known only later still reach the trace

  @unit
  Scenario: PATCH /api/traces/{traceId}/metadata records the metadata and answers the trace id
    Given an API key for a project
    When the key sends PATCH /api/traces/{traceId}/metadata with metadata
    Then the metadata is recorded for that trace in that project
    And the answer is 200 with the trace id

  @unit
  Scenario: PATCH /api/traces/{traceId}/metadata refuses an empty metadata object
    Given an API key for a project
    When the key sends PATCH /api/traces/{traceId}/metadata with no metadata keys
    Then the request is refused as invalid and nothing is recorded
