Feature: The package-boundaries lint rule
  Which workspace package may import which, and which runtime a package role
  may touch at all. `packageRole` used to be one message for seven different
  causes; it is five ids now — `contractRuntime`, `webImportsServer`,
  `serverImportsBrowser`, `coreImportsEnterprise`, `deadAlias` — one per
  shape of violation, so the reported id names the actual mistake.

  Background:
    Given a workspace whose agent and project features are at strict layout version 0

  @unit
  Scenario: A web package importing another feature's server is reported as webImportsServer
    Given a web module that imports a different feature's server package
    When the package-boundaries rule runs over it
    Then it reports webImportsServer

  @unit
  Scenario: A server package importing another feature's web package is reported as serverImportsBrowser
    Given a service module that imports a different feature's web package
    When the package-boundaries rule runs over it
    Then it reports serverImportsBrowser with the import specifier

  @unit
  Scenario: A contract package importing a runtime is reported as contractRuntime
    Given a contract module that imports a node runtime module
    When the package-boundaries rule runs over it
    Then it reports contractRuntime with the import specifier

  @unit
  Scenario: A deleted alias import is reported as deadAlias
    Given a service module that imports through the deleted ~/ alias
    When the package-boundaries rule runs over it
    Then it reports deadAlias with the import specifier

  @unit
  Scenario: Core code importing an enterprise package is reported as coreImportsEnterprise
    Given a core feature's service module that imports an enterprise feature's server package
    When the package-boundaries rule runs over it
    Then it reports coreImportsEnterprise

  @unit
  Scenario: An undeclared export subpath is reported as sealedExports
    Given a service module that imports an undeclared subpath of another package
    When the package-boundaries rule runs over it
    Then it reports sealedExports naming the subpath and the package

  @unit
  Scenario: A well-formed cross-package import within a feature is left alone
    Given a service module that imports its own feature's contract package correctly
    When the package-boundaries rule runs over it
    Then it reports nothing
