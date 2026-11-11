Feature: Stock trace widgets read the light trace table
  On a large project the stock widgets that read `traces` run out of memory, and they read it
  only for a few metadata keys. trace_analytics gets one column per key, computed by ClickHouse
  from the row's Attributes; trace_metrics exposes them; and the 15 widget queries that need
  nothing else from `traces` read trace_metrics instead (tasks#1117). The Attributes map stays
  withheld from trace_metrics (tasks#598).

  Background:
    Given traces whose metadata carries output_action, outcome, sent_to_review, document_type, flow, language, segment, team and topic

  Rule: The metadata keys are columns of trace_metrics

    @integration
    Scenario: The migration fills the metadata columns for existing rows
      Given trace_analytics rows written before migration 00125
      When the migration and its background step have run
      Then each row's metadata columns hold the values of its Attributes
      And a missing key reads as empty text

    @unit
    Scenario: trace_metrics exposes the metadata columns under its own access rules
      When the trace_metrics catalogue is read
      Then each metadata key is a String column named Metadata and the key in PascalCase, such as MetadataOutputAction
      And each carries the same gates as TraceName

    @unit
    Scenario: trace_metrics keeps the Attributes map withheld
      When the trace_metrics catalogue is read
      Then it has no Attributes column

    @unit
    Scenario: trace_metrics keeps its FINAL dedup
      When the trace_metrics catalogue is read
      Then it still deduplicates on TenantId, OccurredAt and TraceId by the latest UpdatedAt

  Rule: The moved widget queries read trace_metrics and return the same rows

    @unit
    Scenario: The moved widget queries read trace_metrics, not traces
      Given the 14 stock queries tasks#1117 lists, plus att-table/passRates, from gen-acceptance/actions to ask-rising/daily
      Then each reads trace_metrics and never traces
      And each keeps to its sources with Source IN {dashboard_context_sources:Array(String)}

    @integration
    Scenario: A moved widget query returns the rows its traces form returned
      Given traces of the application, of Langy and of a simulation
      And a trace that has no trace_metrics row
      When each moved query and its traces form run under the application list and the langy list
      Then both return the same rows

    @integration
    Scenario: A trace with two trace_metrics rows adds its cost once to the summed widgets
      Given an application trace with a second trace_metrics row whose OccurredAt moved
      When the moved queries run under the application list
      Then the queries that sum TotalCost return the same rows as their traces form
      And trace counts stay the same, since they count uniqExact(TraceId)

    @integration
    Scenario: A second trace_metrics row in another bucket or half counts the trace once
      Given an application trace with a second trace_metrics row a bucket later and past the period's midpoint
      When the moved queries run
      Then the queries that bucket or halve the period count the trace once, at its first OccurredAt
      And the queries that sum TotalCost return the same rows as their traces form

    @integration
    Scenario: A second trace_metrics row past the period start keeps the trace before it
      Given a trace from the window before the period with a second trace_metrics row inside the period
      When the queries that split the period run under the application list and the langy list
      Then each counts the trace in the window before only, as its traces form does
      And the other moved queries, which have no first-row filter, still count the trace in the period, unlike their traces form

    @integration
    Scenario: A conversation in two units counts once in each unit's share
      Given a conversation whose traces belong to two customers
      When the share widgets read their per-unit rows and their totals
      Then the totals' conversations equal the sum of the per-unit conversations
      And the shares add up to 100%

    @integration
    Scenario: att-table's pass rates group traces by the units its volumes list
      Given judged application traces, one of them on a unit only trace_metrics carries
      When att-table reads its per-unit volumes and its per-unit pass rates
      Then the units judged in the period are the units its volumes list

  Rule: The moved widgets render on the app

    # Checked by hand on a local stack with seeded traces; see the PR.
    @e2e @unimplemented
    Scenario: The moved widgets render on a running app
      Given a board holding the moved widgets
      When a member opens it
      Then every moved widget shows its numbers rather than an error
