Feature: ClickHouse table descriptors in the table-ownership policy
  The typed builder (ADR-202) names a table through a descriptor,
  `defineClickHouseTable({ name: "..." })`, instead of a string literal. The
  clickhouse-table-ownership policy resolves a descriptor to its table, so a
  ported repository keeps its owner, its writes and its reads. A module that
  reads a table through another module's descriptor, or its own copy of one,
  is a reader of it, admitted only by that table's share declaration; declaring
  a descriptor alone is not access.

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
  Scenario: A database-qualified insert through a descriptor's table name is a write
    Given trace declares a descriptor of trace_summaries
    When trace's repository inserts into `${database}.${descriptor.$table.name}`
    Then trace writes trace_summaries
    And the same insert through a name nothing binds records no write

  @unit @architecture
  Scenario: A builder read from a foreign descriptor is a foreign read
    Given trace writes trace_summaries
    And analytics declares its own descriptor of trace_summaries
    When analytics' repository reads from that descriptor with the builder
    Then the policy reports that analytics reads trace_summaries, owned by trace
    And a space before the builder call's bracket changes nothing

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

  @unit @architecture
  Scenario: A local alias of a foreign descriptor is a foreign read
    Given trace writes trace_summaries
    When analytics' repository binds its descriptor of trace_summaries to a local alias and reads from the alias
    Then the policy reports that analytics reads trace_summaries, owned by trace
    And the read passes once trace shares trace_summaries with analytics

  @unit @architecture
  Scenario: A shadowed descriptor name resolves to its nearest binding
    Given analytics binds a foreign descriptor, inside a block, to a local name that shadows its own descriptor
    When analytics reads and inserts through that name inside the block and outside it
    Then the accesses inside the block are of trace_summaries
    And the accesses outside it are of analytics' own table
