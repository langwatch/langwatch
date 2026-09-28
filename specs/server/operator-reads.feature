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
