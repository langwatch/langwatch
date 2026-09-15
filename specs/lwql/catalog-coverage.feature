Feature: Every customer-owned table is an LWQL dataset, by default

  As a coding agent (or any API client) calling the LangWatchQL query door
  I want every table LangWatch stores on my behalf to already be a queryable
  dataset, with only its sensitive columns gated
  So that I never hit a wall asking about data I know LangWatch has, and a new
  table added to the product shows up for me without anyone having to remember
  to catalog it

  Issue: #8085 (Part 2B — full catalog coverage).

  Rule: The catalog is opt-out, not opt-in

    @unit @unimplemented
    # Proof: catalog/__tests__/tenantTableCoverage.unit.test.ts (coverage guard)
    Scenario: A customer table is a dataset without anyone adding it by hand
      Given a ClickHouse table that stores rows scoped to a customer's project
      When the LangWatchQL catalog is built
      Then that table is queryable as a dataset named after it
      And no one had to write a dataset definition for it to appear

    @unit @unimplemented
    # Proof: catalog/__tests__/deriveDefaultCatalog.unit.test.ts
    Scenario: A newly migrated table appears as a dataset on its own
      Given a table added by a database migration that has never been catalogued
      When the columns manifest is regenerated for that migration
      Then the table appears as an LWQL dataset
      And free-text columns on it are gated by default
      And no catalog file needed to be edited for it to appear

  Rule: Only non-data tables are left out, and each has a reason

    @unit @unimplemented
    # Proof: catalog/__tests__/tenantTableCoverage.unit.test.ts (coverage guard)
    Scenario: Every excluded table is bookkeeping, not customer data
      Given the full set of tables LangWatch stores
      When a table is missing from the queryable dataset list
      Then that table is migration bookkeeping, an internal index, or an
        insert-trigger view with no independent data of its own
      And its exclusion carries a written reason

    @unit @unimplemented
    # Proof: catalog/__tests__/tenantTableCoverage.unit.test.ts (coverage guard)
    Scenario: A table cannot be silently dropped from the catalog
      Given a table that stores rows scoped to a customer's project
      When it is neither catalogued as a dataset nor listed as excluded with a reason
      Then the catalog build fails

  Rule: Sensitive columns are refused, never silently dropped

    @integration @unimplemented
    # Proof: catalog/__tests__/gatedColumns.integration.test.ts
    Scenario: Asking for a gated column without the matching privacy setting is refused
      Given a project whose privacy settings do not permit reading captured content or cost
      When a caller asks for a content or cost column on any dataset
      Then the request is refused, naming the gated column
      And the request is not silently answered with that column left out

    @integration @unimplemented
    # Proof: catalog/__tests__/gatedColumns.integration.test.ts
    Scenario: Every other column on the same dataset is still readable
      Given a project whose privacy settings do not permit reading captured content or cost
      When a caller asks only for columns that carry no content or cost
      Then they get those columns back
      And nothing about the request is refused

  Rule: The schema endpoint is the one list of datasets, for people and for Langy

    @integration @unimplemented
    # Proof: catalog/__tests__/schemaEndpointCoverage.integration.test.ts
    Scenario: The schema endpoint lists every dataset in the catalog
      Given the full set of catalogued datasets
      When a caller asks the query door what it can query
      Then every catalogued dataset is listed with its columns
      And every gated column is marked with what gates it

    @integration @unimplemented
    # Proof: catalog/__tests__/schemaEndpointCoverage.integration.test.ts
    Scenario: Langy sees exactly the same datasets as the schema endpoint
      Given the full set of catalogued datasets
      When Langy is asked what data it can query on the caller's behalf
      Then it lists the same datasets the schema endpoint lists
      And it carries no separate, hand-kept list of its own

  Rule: Rollups and structured columns are queryable, not just raw event rows

    @integration @unimplemented
    # Proof: catalog/__tests__/rollupTables.integration.test.ts
    Scenario: A rollup table returns its finalised values
      Given a metric that has already been rolled up into a summary table
      When a caller asks that table for the metric's value over a time range
      Then they get the finalised rolled-up value
      And they do not have to re-derive it from raw events themselves

    @integration @unimplemented
    # Proof: catalog/__tests__/attributeColumns.integration.test.ts
    Scenario: A map-typed attribute column is queryable by key
      Given a dataset whose attributes are stored as a single map-typed column
      When a caller asks for the value of one attribute key
      Then they get that attribute's value
      And they do not need to know the map column's storage format to ask for it
