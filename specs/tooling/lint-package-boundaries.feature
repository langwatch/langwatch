Feature: The package-boundaries lint rule
  Which workspace package may import which, and which runtime a package role
  may touch at all, over the module tree ARCHITECTURE.md §3 describes: every
  module's contract, process, browser and browser-kit package, core and
  enterprise. Each shape of violation has its own id, so the reported id names
  the actual mistake and its fix names the door to use instead.

  Background:
    Given a workspace whose agent and project modules each have a contract, process, browser and browser-kit package
    And an enterprise governance module with a contract and a process package

  @unit
  Scenario: A browser package importing another module's browser package is reported as crossModuleBrowser
    Given a browser module that imports a subpath of another module's browser package
    When the package-boundaries rule runs over it
    Then it reports crossModuleBrowser at that import
    And the fix names the owner's browser kit

  @unit
  Scenario: A browser package importing another module's kit is left alone
    Given a browser module that imports another module's browser kit
    When the package-boundaries rule runs over it
    Then it reports nothing

  @unit
  Scenario: A browser kit importing a browser package or another kit is reported as kitLeaf
    Given a browser kit that imports its own module's browser package, another kit, or only contracts, the design system and the host
    When the package-boundaries rule runs over it
    Then it reports kitLeaf for the browser package and for the other kit
    And it reports nothing for contracts, the design system and the host

  @unit
  Scenario: A browser kit that fetches is reported as kitFetches
    Given a browser kit that imports the browser tRPC client
    When the package-boundaries rule runs over it
    Then it reports kitFetches

  @unit
  Scenario: A process package importing another module's process package is reported as crossModuleProcess
    Given a service that imports another module's process package
    When the package-boundaries rule runs over it
    Then it reports crossModuleProcess naming the owner's Api and contract

  @unit
  Scenario: A test installs a peer module or reads its test seam
    Given a module's test that imports a peer's process module installer, or the peer's declared ./testing entry
    When the package-boundaries rule runs over it
    Then it reports nothing
    But a test that imports the peer's service is reported as crossModuleProcess
    And production code that reads the peer's ./testing entry is reported as crossModuleProcess

  @unit
  Scenario: A module's own tests import its own process package
    Given a module's test that imports its own module's process package
    When the package-boundaries rule runs over it
    Then it reports nothing

  @unit
  Scenario: A browser package importing a process package is reported as browserImportsProcess
    Given a browser module that imports a process package
    When the package-boundaries rule runs over it
    Then it reports browserImportsProcess

  @unit
  Scenario: A process package importing a browser package is reported as processImportsBrowser
    Given a service that imports a browser kit
    When the package-boundaries rule runs over it
    Then it reports processImportsBrowser with the import specifier

  @unit
  Scenario: A contract package importing a runtime is reported as contractRuntime
    Given a contract module that imports a node runtime module
    When the package-boundaries rule runs over it
    Then it reports contractRuntime with the import specifier

  @unit
  Scenario: Core code importing an enterprise implementation is reported as coreImportsEnterprise
    Given a core module's service that imports an enterprise module's process package
    When the package-boundaries rule runs over it
    Then it reports coreImportsEnterprise

  @unit
  Scenario: Core code may depend on an enterprise module's contract
    Given a core module's service that imports an enterprise module's peer Api from its contract
    When the package-boundaries rule runs over it
    Then it does not report coreImportsEnterprise

  @unit
  Scenario: An undeclared export subpath is reported as sealedExports
    Given a service that imports an undeclared subpath of another package
    When the package-boundaries rule runs over it
    Then it reports sealedExports naming the subpath and the package

  @unit
  Scenario: A composition root naming a process package is told to compose through the module
    Given an application's main.ts, or any other file of an application, that imports a module's process package
    When the package-boundaries rule runs over it
    Then it reports compositionRoot
    And the fix names the generated installed-server-modules list

  @unit
  Scenario: Code outside a module importing its process package is reported as processOutsideModule
    Given a workspace package outside every module that imports a module's process package
    When the package-boundaries rule runs over it
    Then it reports processOutsideModule

  @unit
  Scenario: Code outside a module reaching past a browser declaration is reported as browserSideDoor
    Given the browser application's shell importing a browser package
    When the import names a subpath other than ./declaration
    Then it reports browserSideDoor
    But an import of ./declaration is left alone

  @unit
  Scenario: A relative import into another package is reported as packageEscape
    Given a service that imports another module's process source by relative path
    When the package-boundaries rule runs over it
    Then it reports packageEscape

  @unit
  Scenario: A well-formed cross-package import within a module is left alone
    Given a service that imports its own module's contract package
    When the package-boundaries rule runs over it
    Then it reports nothing
