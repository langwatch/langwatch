Feature: A read bounded below on evaluation_metrics.OccurredAt deduplicates only from that bound
  evaluation_metrics keeps each evaluation's latest version with an IN set over every evaluation
  of the project, with no time bound, so the attribution widgets ran out of memory even with spill
  on. The fold writes OccurredAt as the running max of an evaluation's event times, so a newer
  version is never earlier than an older one. When a statement bounds OccurredAt below, the
  executor reads the view's floored twin, whose dedup reads only versions from that bound. Why:
  modules/analytics/adrs/005-evaluation-metrics-dedup-floor.md.

  @unit @integration
  Scenario: A read bounded below on OccurredAt deduplicates only from that bound
    Given evaluations with a version before the window and the latest inside it
    And evaluations with a version inside the window and the latest after it
    And an evaluation with a single version inside the window
    When a statement reads evaluation_metrics with OccurredAt at or after the window's start
    Then the executor sends it to evaluation_metrics__floor from that start
    And it returns the rows the whole-history view returns

  @unit @integration
  Scenario: A read bounded on another column keeps the whole-history dedup
    Given a statement that windows evaluation_metrics on UpdatedAt
    Then the executor sends it as written
    And it returns the rows the whole-history view returns

  @unit @integration
  Scenario: A read with no window keeps the whole-history dedup
    Given a statement that reads evaluation_metrics with no time condition
    Then the executor sends it as written

  @integration
  Scenario: Of two evaluations, only the one whose latest version is inside the window is read
    Given one evaluation whose latest version is inside the window
    And one whose latest version is before the start, and one whose latest version is after the end
    When a statement reads evaluation_metrics bounded on OccurredAt to the window
    Then it returns only the first evaluation's latest version, as the whole-history view does

  @unit
  Scenario: A bound that cannot filter the view first is not pushed
    Given a statement whose only bound on OccurredAt is an upper bound, inside an OR, reads a column, is shadowed by a select alias, sits on the outer side of a LEFT JOIN, or is unqualified beside a second table
    And the cases where the bound is NULL or calls a function outside the query-constant allow-list
    And the case where the table qualifier is also a select alias
    Then the executor sends it as written

  @unit @integration
  Scenario: A bound in another time zone floors from the same instant
    Given a statement bounded below on OccurredAt by a time written in Asia/Tokyo
    When the executor sends it to evaluation_metrics__floor
    Then the twin's bound is that instant in the server's time zone
    And it returns the rows the whole-history view returns

  @unit
  Scenario: A caller cannot read the floored twin directly
    Given a statement that names evaluation_metrics__floor by name, quoted, database-qualified, under an alias, in a subquery, behind a WITH of the same name, in a JOIN, in a UNION or as a table function
    Then the validator refuses it

  @integration
  Scenario: A floored twin returns only the calling tenant's rows
    Given a floored twin of each view and rows seeded for two tenants
    When the restricted identity of one tenant reads the twin from a floor before every seeded row
    Then it returns rows, and every row is that tenant's

  @unit
  Scenario: A floored twin missing a column of its view is rebuilt
    Given a floored twin that ClickHouse reports lacking a catalog column of its view, or a twin with no column data beside a view that lacks one
    Then the reconvergence check names the twin as drift

  @unit
  Scenario: A read the twin cannot answer yet is sent as written
    Given a deployment where evaluation_metrics__floor is not provisioned yet
    When the floored statement is refused as unavailable, which a missing twin maps to
    Then the executor sends the statement as written and returns its rows
    And a deployment missing the view itself still refuses as unavailable

  @unit
  Scenario: A twin the server reports as an unknown table function is unavailable
    Given a floored statement on a deployment where the twin is not provisioned yet
    When ClickHouse refuses it with UNKNOWN_FUNCTION naming the twin as an unknown table function
    Then the executor refuses it as unavailable, so the floor sends the statement as written
    And an unknown table function that is not a twin the statement reads keeps its old refusal
    And an unknown native function in a floored statement keeps its old refusal
    And an unknown app function in a floored statement still refuses as app function unavailable

  @integration
  Scenario: A dated widget read on a deployment missing its floored twin answers as written
    Given the stock spend widget, which reads trace_metrics bounded to the board's period
    And a deployment where trace_metrics__floor exists, and then one where it was never provisioned
    When the widget is read through the shipped executor on each
    Then the first reads the twin, the second is sent as written after the twin is refused
    And both return the rows and completeness total the statement returns as written
    And the floored read on its own is refused as unavailable over ClickHouse's UNKNOWN_FUNCTION (46)

  @unit
  Scenario: A read the twin's grant does not cover yet is sent as written
    Given a deployment where evaluation_metrics__floor exists but its grant has not landed yet
    When the floored statement is refused for access
    Then the executor sends the statement as written once and returns its rows
    And a deployment that denies the view itself still refuses as provisioning incomplete

  # Latest-in-order views (analytics ADR-006, amendment 2026-11-16): the caller's bound cannot
  # reach the table through LIMIT 1 BY, so a widget read every version the tenant ever wrote.

  @unit
  Scenario: A read bounded below on a latest-in-order view's floor column reads its floored twin
    Given a statement that reads trace_metrics bounded below on OccurredAt
    And a bound that takes the least of two query constants
    When the executor sends it
    Then it reads the view's floored twin from that bound

  @unit
  Scenario: A read bounded below on traces.OccurredAt or evaluations.ScheduledAt keeps the whole-history dedup
    Given a statement that reads traces bounded below on OccurredAt, or evaluations bounded below on ScheduledAt
    And a newer version of a row in either can carry an earlier value of that column than an older one
    When the executor sends it, as a stock query or as a saved widget's own read
    Then it reads the view as written, with no floored twin

  @unit
  Scenario: A floored twin of a latest-in-order view reads the source from its bound before LIMIT 1 BY
    Given trace_metrics, which declares a floor column
    When its floored twin is provisioned
    Then the twin reads its source table from the bound before it keeps one version per key
    And a latest-in-order view that declares no floor column, such as traces, evaluations or simulations, gets no twin

  @integration
  Scenario: Every stock read of evaluations bounded below on ScheduledAt reads the view as written and returns its rows
    Given evaluation runs whose versions are written on either side of each stock bound
    When each stock query that bounds evaluations below on ScheduledAt is read as written and as the executor sends it
    Then the executor sends every read of evaluations to the view itself, with no floored twin
    And it returns the rows the statement returns as written

  @unit
  Scenario: A completeness report on a floored view reads its floored twin
    Given a windowed statement over trace_metrics, which declares a floor column
    When the completeness report beside it is read
    Then it reads trace_metrics__floor from the window's start, and keeps the range from start to end
    And when the twin is not provisioned yet it is read as written and still reports
    And a report over traces, which has no floored twin, is read as written

  @unit
  Scenario: Every trace_metrics read of the changes and capability-gap stock queries reads its floored twin
    Given the stock queries for model and prompt changes and for capability gaps
    When the executor sends them
    Then every read of trace_metrics goes to its floored twin
    And every read of traces is sent as written

  @unit
  Scenario: Every deduplicated view floors a bounded read or says why it cannot
    Given every catalog view whose dedup strategy, the shipped default included, is not none
    Then each declares a floor column and provisions exactly one floored twin, or is listed with the reason it takes none
    And the list names only deduplicated views that declare no floor column
