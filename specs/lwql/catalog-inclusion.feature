Feature: The LangWatchQL catalog is opt-in — a table or model is queryable only when it is on its store's include list

  As a LangWatch operator relying on the app to write the LangWatchQL access model
  I want a new Postgres model or ClickHouse table to be unreachable until it is deliberately listed
  So that a table is never exposed by accident now that the app writes grants straight from the catalog

  Issue: #8263.

  # ADR-136 derived both halves opt-out (everything exposed unless skipped-with-a-reason).
  # ADR-142 flips both halves to opt-in: one include list per store is the only way a
  # model or table enters the catalog. catalog/postgresIncludedModels.ts and
  # catalog/includedTables.ts are those lists; the derivation refuses an entry that
  # names nothing, and the coverage guards pin the split. #8258 (ADR-141) makes the
  # app write grants from the catalog on boot, so a smaller catalog is smaller grants.
  #
  # Bound by tenantModelCoverage.unit.test.ts and tenantTableCoverage.unit.test.ts.

  Rule: A model or table enters the catalog only through its include list

    @unit
    Scenario: A model that is not on the include list is not queryable
      Given a Prisma model with a tenant column that the include list does not name
      When the Postgres catalog is derived
      Then no view is produced for it
      And no grant the app writes references it

    @unit
    Scenario: A table that is not on the include list is not queryable
      Given a ClickHouse manifest table that the include list does not name
      When the ClickHouse catalog is derived
      Then no view is produced for it
      And no grant the app writes references it

  Rule: An include-list entry must name something that exists

    @unit
    Scenario: An include-list entry whose model no longer exists fails the build
      Given an include-list entry that names no Prisma model
      When the Postgres catalog is derived
      Then it fails and names the entry

    @unit
    Scenario: An include-list entry whose table no longer exists fails the build
      Given an include-list entry that names no ClickHouse manifest table
      When the ClickHouse catalog is derived
      Then it fails and names the entry

  Rule: The flip changes nothing a caller can observe

    @unit
    Scenario: The catalogued views regenerate byte-identical from the include lists
      Given the include lists seeded with everything currently catalogued
      When the query reference and its fixture are regenerated from the catalog
      Then every published view, column and example is unchanged

    @unit
    Scenario: An ADR records the opt-out to opt-in flip
      Given the LangWatchQL ADR series
      When the catalog-inclusion ADR is looked up
      Then it exists, is listed in the ADR index, and records the opt-in decision
