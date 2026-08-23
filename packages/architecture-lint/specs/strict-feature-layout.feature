# See ../adrs/002-versioned-strict-feature-layout.md

Feature: Strict versioned feature source layout
  As a maintainer
  I want feature internals to follow one versioned grammar
  So that packages remain predictable without freezing architecture forever

  @unit @architecture
  Scenario: A strict feature declares the initial layout version
    Given a feature root contains feature.json with layoutVersion 0
    And its contract and server files use the version-0 directories and names
    When architecture lint checks the workspace
    Then no feature-source-layout violation is reported

  @unit @architecture
  Scenario: Unknown or missing layout versions fail
    Given a feature has no readable feature.json or declares a version other than 0
    When architecture lint checks the workspace
    Then it reports the feature root and the supported layout version

  @unit @architecture
  Scenario: Server artifacts have canonical homes and names
    Given a layout-version-0 server source file
    When it represents a service, repository, store, projection, port, adapter, API, or migration
    Then it is beneath the matching canonical directory
    And its filename follows the version-0 dot-separated grammar
    And an unknown top-level source directory is rejected

  @unit @architecture
  Scenario: Contract artifacts remain portable and named
    Given a layout-version-0 contract
    When it declares service, command, query, event, or error modules
    Then each module includes a lower-case kebab-case subject before its artifact suffix
    And server-only artifact suffixes are rejected from contract source

  @unit @architecture
  Scenario: Behaviour-bearing modules are classes
    Given a layout-version-0 service, store, projection, API, migration, or repository module
    When Oxlint checks the module
    Then it requires the corresponding class kind
    And concrete runtime classes expose static create
    And standalone factories do not replace the class

  @unit @architecture
  Scenario: Internal server dependencies point toward the service contract
    Given a layout-version-0 server package
    When an API imports persistence or a service imports API, migration, or a concrete adapter
    Then Oxlint reports a feature-layer violation
    And the diagnostic identifies the allowed dependency direction

  @integration @architecture
  Scenario: Layout evolution is explicit
    Given a future convention is materially different from layout version 0
    When the convention is introduced
    Then it is implemented as layout version 1 with its own ADR, spec, and fixtures
    And existing version-0 packages retain their original rules until migrated
