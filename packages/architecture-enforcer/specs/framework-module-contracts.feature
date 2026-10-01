Feature: Framework packages depend on no module contract
  As a maintainer
  I want a packages/* manifest edge onto a module contract reported
  So that browser-host, ui-kernel and process-server stop knowing features

  See dev/docs/ARCHITECTURE.md §10.1 (Alex, 2026-10-01): today's edges are a shrink-only list.

  @unit @architecture
  Scenario: A framework package depending on a module contract is reported
    Given packages/browser-host declares a module's contract under any dependency field
    When the framework-module-contracts policy reads the manifests
    Then the edge is reported against the framework package's manifest

  @unit @architecture
  Scenario: A module depending on its own or a peer's contract is not reported
    Given a module's browser package declares a contract
    When the framework-module-contracts policy reads the manifests
    Then nothing is reported

  @unit @architecture
  Scenario: No framework package gains a module contract dependency
    Given the checked-in list of today's framework-to-contract edges
    When the tree's manifests are read
    Then no edge exists that the list does not hold

  @unit @architecture
  Scenario: A dropped contract dependency leaves the list in the same change
    Given the checked-in list of today's framework-to-contract edges
    When the tree's manifests are read
    Then every listed edge is still present
