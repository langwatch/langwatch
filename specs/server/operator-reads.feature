Feature: Declared operator reads across organizations
  As the platform operator reading one guarded model across every organization
  I want the cross-organization read declared by the module that owns the table
  So that the default guarded client stays strict for every model and each such read is on record

  # Background: the organization guard used to exempt a few models model-wide
  # for predicate-less reads. A module now declares `static readonly operatorReads`
  # naming one model and its read actions; the stores owner builds that handle's
  # client from the raw connection, and boot scopes and seals it like secrets.

  @unit
  Scenario: An unscoped read without a declaration is refused
    Given the default guarded client
    When a findMany on an organization-scoped model names no organization
    Then the query is refused before it reaches the database

  @unit
  Scenario: A declared operator read refuses a model it did not declare
    Given an operator read declared for one model
    When its client reads a different model
    Then the query is refused naming the declaring module

  @unit
  Scenario: A declared operator read refuses writes
    Given an operator read declared for one model with read actions
    When its client writes to that model
    Then the write is refused naming the declaring module

  @unit
  Scenario: A declared operator read is admitted and logged
    Given an operator read declared for one model with findMany
    When its client runs a findMany naming no organization
    Then the read reaches the database
    And one info line records the declaring module, the model and the action, and no row data

  @unit
  Scenario: A module cannot resolve an operator read it did not declare
    Given a module scoped to its own operator-read handles
    When it resolves another module's handle
    Then the resolve is refused naming the module

  @unit
  Scenario: Operator reads cannot be resolved after boot
    Given the operator reads resolver has sealed
    When a module resolves its declared handle
    Then the resolve is refused

  # Governance declares the suppression snapshot's two reads (ErasedIdentifierSuppression,
  # GovernanceTenantHistory, findMany only); the guard exempts neither model any more.

  @unit
  Scenario: Governance reads the erasure snapshot across organizations through its declared handles
    Given governance declared operator reads of the suppression and tenant-history tables
    When the erasure suppression snapshot loads
    Then every organization's digests and tenants are read through those two handles

  @unit
  Scenario: Governance's erasure snapshot is refused where its operator reads were not declared
    Given governance's operator reads scoped to no handles
    When its live repositories build the suppression snapshot
    Then the build is refused and no client is minted

  # Enterprise scim owns ScimSyncState and declares its operator read (findMany, count), so
  # /ops/backoffice/directory-sync pages every organization's syncs without a guard exemption.

  @unit
  Scenario: Scim lists every organization's directory syncs through its declared handle
    Given scim declared an operator read of ScimSyncState with findMany and count
    When the platform operator lists directory syncs
    Then every organization's syncs are paged and counted through that handle
    And the guarded client is not asked

  @unit
  Scenario: Scim's directory-sync list is refused where its operator read was not declared
    Given scim's operator reads scoped to no handles
    When its live repositories build the directory-sync store
    Then the build is refused and no client is minted
