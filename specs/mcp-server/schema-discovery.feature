@integration
Feature: MCP Schema Discovery Tool
  As a coding agent
  I want to discover available filters, metrics, and options
  So that I can construct accurate queries without memorizing the schema

  Background:
    Given the MCP server is running

  Scenario: Agent discovers available filter fields
    When the agent calls discover_schema with category "filters"
    Then the response lists all available filter fields
    And each field includes a name and human-readable description
    And the fields include "metadata.user_id", "spans.model", and "evaluations.passed"

  Scenario: Agent discovers available metrics with allowed aggregations
    When the agent calls discover_schema with category "metrics"
    Then the response lists metrics organized by category
    And each metric includes its name, label, and allowed aggregation types
    And the performance category includes "completion_time" and "total_cost"

  Scenario: Agent discovers available group-by options
    When the agent calls discover_schema with category "groups"
    Then the response lists all group-by options
    And each option includes a name and description
    And the options include "model", "topics", and "users"

  Scenario: Agent discovers all schema information at once
    When the agent calls discover_schema with category "all"
    Then the response includes filters, metrics, aggregations, and groups sections
