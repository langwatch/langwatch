@integration
Feature: MCP Schema Discovery Tool
  As a coding agent
  I want to discover available filters, metrics, options and query languages
  So that I can construct accurate queries without memorizing the schema

  The filter half of this tool used to be a hand-copied list of 24 field names
  living in the MCP package. It drifted: it named fields the platform had
  renamed, and missed the ones the Trace Explorer had gained. The platform now
  publishes both query languages at `GET /api/v1/query/reference`, and the
  filters and lwql categories read it, so the tool cannot describe a field the
  platform does not have.

  The consequence is that those categories need the API key, which the metrics,
  aggregations, groups, scenarios and evaluators categories still do not.

  Background:
    Given the MCP server is running

  Scenario: Agent discovers available filter fields
    When the agent calls discover_schema with category "filters"
    Then the response lists the trace filter fields the platform publishes
    And each field includes a name and human-readable description
    And the response documents the attribute prefixes and the filter syntax

  Scenario: Agent discovers the analytics SQL schema
    When the agent calls discover_schema with category "lwql"
    Then the response lists the analytics datasets with their columns and time columns
    And the response carries runnable example statements

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

  Scenario: Agent discovers the suite fields and the evaluator attachments
    When the agent calls discover_schema with category "scenarios"
    Then the response documents the field identifier rules and the three field types
    And the response documents the evaluator attachment shape
    And the response lists every mapping path of the conversation, the scenario and the trace

  Scenario: Agent discovers all schema information at once
    When the agent calls discover_schema with category "all"
    Then the response includes the filters, analytics SQL, metrics, aggregations, and groups sections

  Scenario: Agent runs an analytics SQL statement and reads a table
    When the agent calls run_query with a statement
    Then the statement is sent to the analytics query endpoint unchanged
    And the response renders the columns and rows as a markdown table

  Scenario: A long result is capped and says so
    When run_query returns more rows than the tool prints
    Then the table holds the printed rows only
    And the response says how many rows the statement returned

  Scenario: Agent filters a trace search with the trace filter language
    When the agent calls search_traces with a filter string
    Then the search request carries that filter
