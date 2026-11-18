Feature: LangWatchQL view sources in the table-ownership policy
  A LangWatchQL view is provisioned as `SELECT ... FROM langwatch.<sourceTable>`,
  so analytics reads each view's source table at runtime. The
  clickhouse-table-ownership policy counts a view's `sourceTable: "<table>"`
  as a read by the module declaring it, admitted only by that table's share
  declaration (ADR-202, Decided 21). A view is a `*ViewDefinition` declaration
  or a `defineTableCatalogue({ ... })` table; no other object's key counts.

  Background:
    Given the policy reads the table list from the goose migrations
    And trace writes trace_summaries

  @unit @architecture
  Scenario: A LangWatchQL view over another module's table is a foreign read
    Given analytics' view catalogue declares a view whose sourceTable is trace_summaries
    When the clickhouse-table-ownership rule runs over the workspace
    Then the policy reports that analytics reads trace_summaries, owned by trace

  @unit @architecture
  Scenario: A shared table read only through a LangWatchQL view keeps its share
    Given trace shares trace_summaries with analytics
    And analytics reads trace_summaries only through a view's sourceTable
    When the clickhouse-table-ownership rule runs over the workspace
    Then no finding names trace_summaries

  @unit @architecture
  Scenario: A sourceTable outside a LangWatchQL view declaration is not a read
    Given analytics declares an untyped object whose sourceTable is trace_summaries
    And a defineTableCatalogue table whose sourceTable is trace_summaries
    When the clickhouse-table-ownership rule runs over the workspace
    Then only the catalogue table's sourceTable is a read

  @unit @architecture
  Scenario: A sourceTable that names no ClickHouse table is not a read
    Given analytics' view catalogue declares a view whose sourceTable is a PostgreSQL table
    When the clickhouse-table-ownership rule runs over the workspace
    Then the policy records no access by analytics
