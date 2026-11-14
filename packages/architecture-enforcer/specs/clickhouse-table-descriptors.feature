Feature: ClickHouse table descriptors in the table-ownership policy
  The typed builder (ADR-202) names a table through a descriptor,
  `defineClickHouseTable({ name: "..." })`, instead of a string literal. The
  clickhouse-table-ownership policy resolves a descriptor to its table, so a
  ported repository keeps its owner, its writes and its reads. A module that
  declares a descriptor of another module's table is a reader of it, admitted
  only by that table's share declaration.

  Background:
    Given the policy reads the table list from the goose migrations

  @unit @architecture
  Scenario: A module inserting through its descriptor's table name owns the table
    Given trace declares a descriptor of trace_summaries
    When trace's repository inserts with the descriptor's $table.name as the table
    Then trace owns trace_summaries
    And no finding names trace_summaries

  @unit @architecture
  Scenario: A constant set from a descriptor's table name is that table
    Given trace's repository binds a constant to the descriptor's $table.name
    When it inserts with that constant as the table, and substitutes it into SQL
    Then trace owns trace_summaries

  @unit @architecture
  Scenario: A builder read from a foreign descriptor is a foreign read
    Given trace writes trace_summaries
    And analytics declares its own descriptor of trace_summaries
    When analytics' repository reads from that descriptor with the builder
    Then the policy reports that analytics reads trace_summaries, owned by trace

  @unit @architecture
  Scenario: A builder join on a foreign descriptor is a foreign read
    Given trace writes trace_summaries
    When analytics' repository joins an imported descriptor of trace_summaries
    Then the policy reports that analytics reads trace_summaries, owned by trace

  @unit @architecture
  Scenario: A read handed a descriptor's table name is a read
    Given trace writes trace_summaries
    When analytics hands a read the descriptor's $table.name as its table
    Then the policy reports that analytics reads trace_summaries, owned by trace

  @unit @architecture
  Scenario: A descriptor reached through a re-export is still the table
    Given trace's descriptor is re-exported by a barrel
    When trace's repository inserts with the imported descriptor's $table.name
    Then trace owns trace_summaries

  @unit @architecture
  Scenario: A foreign descriptor read on the share list passes
    Given trace shares trace_summaries for reading with analytics
    When analytics reads from its descriptor of trace_summaries with the builder
    Then no finding names analytics

  @unit @architecture
  Scenario: Declaring a descriptor is not access
    Given analytics declares a descriptor of trace_summaries and never uses it
    When the policy runs
    Then trace_summaries has no reader in analytics
