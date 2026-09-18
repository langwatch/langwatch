Feature: Every tenant-scoped Postgres table is queryable through LangWatchQL by default

  As a LangWatch project member or API client using the LangWatchQL query door
  I want every Postgres table that holds data my project can access to be a view, without anyone hand-adding it
  So that a topic name, a dataset size, or an alert count is as reachable as a trace, and a new table cannot silently stay off the catalog

  Issue: #8207.

  # The ClickHouse half of the catalog already works this way: catalog/derivedViews.ts
  # derives every table unless it is hand-written or named, with a reason, in
  # catalog/skippedTables.ts, and tenantTableCoverage.unit.test.ts fails on a table
  # that is neither. This feature gives the Postgres half the same contract.
  #
  # Every scenario is @unimplemented until the derivation lands. The first PR
  # that binds one removes this file from LEGACY_INERT in check-feature-parity.ts.

  Background:
    Given the LangWatchQL Postgres catalog is derived from the Prisma schema

  Rule: Exposure is the default, not a decision

    # @unimplemented: needs derivePostgresCatalog; bind from its unit test.
    @unit @unimplemented
    Scenario: A model with a project column becomes a view without a hand-written definition
      Given a Prisma model that carries a projectId column and is not on the skip list
      When the Postgres catalog is derived
      Then a view named after the model in snake_case exists in the catalog
      And its projectId column is exposed as TenantId
      And every other column is exposed in PascalCase

    # @unimplemented: coverage guard is the mirror of tenantTableCoverage.unit.test.ts.
    @unit @unimplemented
    Scenario: A new tenant-scoped model that is neither derived, overridden nor skipped fails the build
      Given a Prisma model with a tenant column that no view, override or skip entry names
      When the tenant model coverage check runs
      Then it fails and names the model
      And the failure says to catalogue it or skip it with a reason

    # @unimplemented: bind from the skip-list invariants test.
    @unit @unimplemented
    Scenario: A skip needs a recorded reason
      Given a model placed on the Postgres skip list
      When the skip list is validated
      Then every entry carries a non-empty reason
      And the only accepted reasons are: no tenant column, an internal-only tenant, data already exposed through another view, or access-control plumbing
      And "low value" is not one of them

    # @unimplemented: the six views in postgresViews.ts move onto the derivation.
    @unit @unimplemented
    Scenario: A hand-written view is an override on the derived default, not a second definition
      Given the annotations, projects, prompts, prompt_versions, experiments and batch_evaluations views
      When the Postgres catalog is derived
      Then each of them is produced by the derivation with its override applied
      And no view is defined twice

  Rule: The tenant predicate follows the model's scope

    # @unimplemented: bind from the tenant predicate unit test.
    @unit @unimplemented
    Scenario: A project-scoped model maps straight to the caller's tenant
      Given a model whose tenant column is projectId
      When a caller queries its view
      Then only rows whose projectId is the caller's tenant are returned

    # @unimplemented: one shared fan-out helper, not per-view SQL.
    @unit @unimplemented
    Scenario: An organization-scoped model fans out to one row per project
      Given a model whose tenant column is organizationId
      When the Postgres catalog is derived
      Then the view joins through Project.organizationId and emits one row per project as TenantId
      And the fan-out is the same shared helper for every organization-scoped model

    # @unimplemented: cross-tenant negative test, needs the integration stack.
    @integration @unimplemented
    Scenario: An organization-scoped view never shows another organization's rows
      Given two organizations, each with a project and a gateway virtual key
      When a caller in the first project queries the virtual_keys view
      Then they see only keys belonging to their own organization

    # @unimplemented: GatewayBudgetLedger has no tenant column of its own.
    @unit @unimplemented
    Scenario: A model without a tenant column is reached through a declared parent
      Given a model with no tenant column but a declared parent path to a tenant-scoped model
      When the Postgres catalog is derived
      Then the view exists and takes its TenantId from the parent
      And the model does not need a skip entry

    # @unimplemented: narrowest scope wins.
    @unit @unimplemented
    Scenario: A model with more than one tenant column uses the narrowest
      Given a model that carries both organizationId and projectId
      When the Postgres catalog is derived
      Then TenantId comes from projectId
      And no organization fan-out is applied

  Rule: Safe defaults strip what a caller must never see

    # @unimplemented: bind from the secret denylist walk over every derived view.
    @unit @unimplemented
    Scenario: Secret material is stripped from every derived view
      Given a model with a column whose name matches apiKey, secret, token, or ends in Hash or Key
      When the Postgres catalog is derived
      Then that column is absent from the view
      And a column ending in Id is not treated as a key

    # @unimplemented: reuses catalog/contentGating.ts; the gate from #8176 applies.
    @unit @unimplemented
    Scenario: A content column is gated, not dropped
      Given a model with a JSON or free-text body column named in the content-gating list
      When a caller without content access selects that column
      Then the query is refused with the GATED_COLUMN rule
      And a caller with content access reads it

    # @unimplemented: identity tables are never derived.
    @unit @unimplemented
    Scenario: Identity tables are skipped and person columns stay opaque
      Given the User, Team and Organization models
      When the Postgres catalog is derived
      Then none of them has a view
      And a userId column on any other model is exposed as an opaque id with no join to a person

    # @unimplemented: an override re-admits a column on purpose, with a reason.
    @unit @unimplemented
    Scenario: An override that re-admits a stripped column carries a reason
      Given an override that exposes a column the safe defaults would strip
      When the override is validated
      Then it carries a non-empty reason
      And an override without one fails the build

  Rule: Everything derived is discoverable

    # @unimplemented: catalog ground truth is regenerated from the derivation.
    @unit @unimplemented
    Scenario: The catalog ground truth lists every derived view
      Given the derived Postgres catalog
      When lwql_catalog.json and the columns manifest are regenerated
      Then every derived view and its columns appear in both
      And a stale ground truth fails the check that compares them

    # @unimplemented: the self-describing door from #8113.
    @integration @unimplemented
    Scenario: The self-describing catalog output names every derived view
      Given a caller with an API key for a project
      When they ask the LangWatchQL door to describe itself
      Then every derived Postgres view is listed with its columns

  Rule: Topics are the proving slice

    # @unimplemented: first end-to-end view on the derivation.
    @e2e @unimplemented
    Scenario: Traffic by topic name
      Given a project with traces assigned to topics
      When a caller runs SELECT t.TopicName, count() FROM traces JOIN topics t ON traces.TopicId = t.TopicId GROUP BY 1 LIMIT 50
      Then they get one row per topic with its name and trace count
      And only their own project's topics appear

    # @unimplemented: clustering internals are not customer data.
    @unit @unimplemented
    Scenario: Topic clustering internals are not exposed
      Given the derived topics view
      When its columns are listed
      Then centroid, embeddings_model and p95Distance are absent
      And TopicId, TopicName, ParentTopicId and TenantId are present

  Rule: The gap list burns down to zero

    # @unimplemented: the mechanism lands first with every unhandled model
    # skipped under TODO(#8207); this scenario is the finish line.
    @unit @unimplemented
    Scenario: No model is left on the skip list with a TODO reason
      Given the Postgres skip list
      When it is validated
      Then no entry's reason contains TODO(#8207)
