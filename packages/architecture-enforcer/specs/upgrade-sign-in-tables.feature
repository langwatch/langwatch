Feature: A blocking upgrade step never touches a sign-in or ingest table
  The api serves sign-in and ingestion while the worker upgrades, so a blocking
  step's frozen SQL never touches a table those doors read or write (Alex,
  2026-10-09, UPGRADE-IN-WORKER, UIW-9, API-UP-DURING-UPGRADE). Sign-in tables:
  every table auth, user, organization, authz and identity (SSO config) claim.
  Ingest tables: every table api-key, project, evaluator, monitor, experiment
  and governance claim (key resolution, guardrail lookups, batch result logs,
  governance sources). The policy reuses migration-owners' touch parsing; a
  change to them ships as a background step.

  @unit @architecture
  Scenario: A blocking step whose SQL touches a sign-in table is refused, naming the step and the table
    Given a blocking data step whose frozen SQL updates a table the user module claims
    When the upgrade-sign-in-tables policy runs
    Then it reports the step, naming its id, the table and user as the owner
    And the fix says to ship the change as a background step

  @unit @architecture
  Scenario: A background step touching a sign-in table passes
    Given a background step whose SQL updates a table the organization module claims
    When the upgrade-sign-in-tables policy runs
    Then it reports nothing for that step

  @unit @architecture
  Scenario: A blocking step touching only other owners' tables passes
    Given a blocking data step whose frozen SQL updates a table the dataset module claims
    When the upgrade-sign-in-tables policy runs
    Then it reports nothing for that step

  @unit @architecture
  Scenario: A Postgres schema migration on a sign-in table passes
    Given a Prisma migration that adds a column to a table the auth module claims
    When the upgrade-sign-in-tables policy runs
    Then it reports nothing, because the api holds through the schema phase

  @unit @architecture
  Scenario: The sign-in owners are read from ownership claims
    Given the repository's modules and their Prisma claims
    When the policy resolves the sign-in tables
    Then they are exactly the tables the sign-in and ingest owners claim

  @unit @architecture
  Scenario: The tree has no blocking step touching a sign-in table
    Given the repository's blocking steps
    When the steps touching a sign-in table are counted
    Then there are none
