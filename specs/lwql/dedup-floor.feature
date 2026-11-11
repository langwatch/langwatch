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

  @unit
  Scenario: A floored twin missing a column of its view is rebuilt
    Given a floored twin that ClickHouse reports lacking a catalog column of its view, or a twin with no column data beside a view that lacks one
    Then the reconvergence check names the twin as drift

  @unit
  Scenario: A read the twin cannot answer yet is sent as written
    Given a deployment where evaluation_metrics__floor is not provisioned yet
    When the floored statement is refused as unavailable
    Then the executor sends the statement as written and returns its rows
    And a deployment missing the view itself still refuses as unavailable

  @unit
  Scenario: A read the twin's grant does not cover yet is sent as written
    Given a deployment where evaluation_metrics__floor exists but its grant has not landed yet
    When the floored statement is refused for access
    Then the executor sends the statement as written once and returns its rows
    And a deployment that denies the view itself still refuses as provisioning incomplete
