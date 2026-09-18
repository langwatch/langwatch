Feature: Clustered ClickHouse replicates the LangWatchQL access model

  As a LangWatch operator
  I want ClickHouse access entities and named collections replicated across all nodes
  So that changing the replica count does not lose any access configuration

  Background:
    Given the ClickHouse config renderer is initialized
    And cluster credentials and node configuration are available

  @unit
  Scenario: Replicated mode configures keeper-backed access storage
    Given the ClickHouse config renderer runs in replicated mode
    When it writes the server configuration
    Then the access-entity storage is keeper-backed
    And the XML-defined user directory is listed ahead of the replicated one

  @unit
  Scenario: Replicated access storage replaces the server default rather than merging
    Given the ClickHouse config renderer runs in replicated mode
    When it writes the access-entity storage configuration
    Then the emitted user_directories block carries the replace attribute

  @unit
  Scenario: Replicated mode configures keeper-backed named collections
    Given the ClickHouse config renderer runs in replicated mode
    When it writes the server configuration
    Then named collections are stored in keeper with a propagation timeout of 5000 ms

  @unit
  Scenario: Standalone mode writes no keeper-backed storage configuration
    Given the ClickHouse config renderer runs in standalone mode
    When it writes the server configuration
    Then neither the user-directories file nor the named-collections-storage file is written

  @unit
  Scenario Outline: Access management stays enabled in <mode> mode
    Given the ClickHouse config renderer runs in <mode> mode
    When it writes the server configuration
    Then the admin user can create access entities and named collections through SQL
    And the custom settings prefix is declared

    Examples:
      | mode       |
      | standalone |
      | replicated |

  @unit
  Scenario: Access configuration does not depend on the replica identity
    Given the ClickHouse config renderer runs in replicated mode for two different node identities
    When it writes the server configuration
    Then the access-storage and named-collection files it writes are identical

  @e2e
  Scenario: Every replica starts with the keeper-backed access configuration applied
    Given a clustered ClickHouse with three replicas
    Then every replica reports ready
    And each replica's merged server configuration lists the replicated access storage and not the node-local one

  @e2e
  Scenario: An access entity created on one replica is visible on every replica
    Given a clustered ClickHouse with three replicas
    When an access entity is created through one replica
    Then every other replica reports the same entity

  @e2e
  Scenario: A named collection created on one replica is visible on every replica
    Given a clustered ClickHouse with three replicas
    When a named collection is created through one replica
    Then every other replica reports the same collection

  @e2e
  Scenario: A recreated replica reports existing access entities without re-provisioning
    Given a clustered ClickHouse where an access entity already exists
    When a replica pod is deleted and recreated
    Then the recreated replica reports the entity without any provisioning running
