# See ../adrs/20260820-eventing-framework-boundary.md
Feature: Eventing refactor safety nets

  As a maintainer reshaping the Eventing package
  I want the public surface and the root import graph pinned by tests
  So that a refactor cannot change an entry or reach a datastore tier unnoticed

  @unit
  Scenario: Every package entry exposes a recorded public surface
    Given the root, testing, server and tables entries of the package
    When their exported names, kinds and class method names are listed
    Then the list matches the recorded snapshot for each entry
    But an added, dropped or reshaped export fails the test

  @unit @architecture
  Scenario: The root entry never reaches the server tier
    Given the import graph walked from the root entry
    When every transitively imported relative file is collected
    Then no file under server, repositories/prisma or repositories/clickhouse is reached
    And no file imports @prisma/client or @clickhouse/client
