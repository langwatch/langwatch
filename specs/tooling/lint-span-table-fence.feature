Feature: Span content is read only through the fence
  A braid's condition and a shared grant's window apply only where a statement carries an
  AuthorizedClickHouse marker. The span-table-fence policy keeps every module read of a table
  holding span content behind that marker, so a new read inherits "never fail open".
  (dev/docs/adr/201-braids-show-matching-spans-in-another-projects-traces.md, v1.10)

  Rule: `span-table-fence` keeps stored_spans and trace_summaries behind the fence

    @unit
    Scenario: a span-table read spelling its own tenant predicate is reported
      Given a module statement reading stored_spans with "TenantId = {tenantId:String}"
      When the architecture check runs
      Then it reports the read as bypassing the fence

    @unit
    Scenario: a span-table read with no fence marker is reported
      Given a module statement reading trace_summaries with no tenant marker and no interpolation
      When the architecture check runs
      Then it reports the read as bypassing the fence

    @unit
    Scenario: a span-table read through a fence marker passes
      Given a module statement reading stored_spans under a tenantScopeWithConditions marker
      When the architecture check runs
      Then it reports nothing

    @unit
    Scenario: a named bypass passes and a stale one is reported
      Given a named fence bypass for one module, table and file
      When that file reads the table with its own tenant predicate
      Then the read is not reported
      And a bypass naming a read that no longer exists is reported
