Feature: The LangWatchQL catalog is opt-in — a table or model is queryable only when it is listed

  As a LangWatch operator relying on the app to write the LangWatchQL access model
  I want a new Postgres model or ClickHouse table to be unreachable until it is deliberately listed
  So that a table is never exposed by accident now that the app writes grants straight from the catalog

  Issue: #8258.

  # ADR-136 built both halves opt-out (everything exposed unless skipped-with-a-reason,
  # via a loop over the manifest). This epic flips both halves to opt-in: the catalog
  # is an explicit list of entries — catalog/lwqlViews.ts calls defineCatalogTable once
  # per ClickHouse table and defineCatalogModel once per Prisma model (in
  # catalog/postgresViews.ts). There is no loop over the manifest and no skip list;
  # skippedTables.ts and postgresSkippedModels.ts are gone. Because #8258 makes the app
  # write grants from the catalog, a table off the list is a table off the grants.
  #
  # Bound by catalogInclusion.unit.test.ts.

  Rule: A table or model enters the catalog only by being listed

    @unit
    Scenario: A ClickHouse table not listed in the catalog is not queryable
      Given a ClickHouse manifest table that no catalog entry names
      When the catalog is assembled
      Then no view reads from that table
      And no grant the app writes references it

    @unit
    Scenario: A Prisma model not listed in the catalog is not queryable
      Given a tenant-scoped Prisma model that no catalog entry names
      When the catalog is assembled
      Then no view reads from that model
      And no grant the app writes references it

  Rule: The catalog is an explicit list, not a scan of the schema

    @unit
    Scenario: Adding a manifest table without listing it exposes nothing
      Given a fake table appended to the ClickHouse columns manifest
      When the catalog is assembled from the explicit list
      Then the fake table produces no view
      And the catalog view count is unchanged

    @unit
    Scenario: Adding a Prisma model without listing it exposes nothing
      Given a fake tenant-scoped model appended to the Prisma manifest
      When the catalog is assembled from the explicit list
      Then the fake model produces no view
      And the catalog view count is unchanged

  Rule: The catalogued view names are pinned so a change is deliberate

    @unit
    Scenario: The catalog view names match the pinned list
      Given the assembled LangWatchQL catalog
      When its view names and source tables are listed
      Then they equal the pinned list of 129 views
      And the list fails when a view is added or removed without updating it
