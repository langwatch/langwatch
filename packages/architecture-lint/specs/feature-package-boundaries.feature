# See ../adrs/001-feature-package-boundaries.md

Feature: Feature package boundary lint
  As a monorepo maintainer
  I want package architecture checked like source code
  So that feature boundaries cannot be bypassed by imports or exported types

  @unit @architecture
  Scenario: A valid feature graph passes
    Given a contract package with portable dependencies
    And server and web packages that depend on their own contract
    And another feature is referenced only through its contract
    When architecture lint checks the fixture workspace
    Then no violation is reported

  @unit @architecture
  Scenario: Physical package names match their feature roles
    Given a feature surface package name does not match its path and role
    When architecture lint checks the workspace
    Then it fails with the expected package name and manifest path

  @unit @architecture
  Scenario: Contract production code cannot acquire runtime implementations
    Given contract source imports React, Node, Prisma, server or web code
    When architecture lint checks the package
    Then each forbidden dependency is reported

  @unit @architecture
  Scenario: Governed packages use one schema runtime
    Given a feature contract declares Zod 3 or feature source imports zod/v3 or a Hono-specific Zod adapter
    When architecture lint checks the package
    Then it rejects the import
    And directs the feature to Zod 4 through Standard Schema

  @unit @architecture
  Scenario: Web production code cannot acquire backend dependencies
    Given web source imports Prisma, Node, Hono, Eventing or a feature server
    When architecture lint checks the package
    Then each forbidden dependency is reported

  @unit @architecture
  Scenario: Server production code cannot acquire browser dependencies
    Given server source imports React, Chakra or its feature web package
    When architecture lint checks the package
    Then each forbidden dependency is reported

  @unit @architecture
  Scenario: Cross-feature collaboration uses only contracts
    Given one feature imports another feature's server, web, repository or internal module
    When architecture lint checks the importer
    Then it fails and identifies the other feature's contract as the allowed boundary

  @unit @architecture
  Scenario: Core packages cannot import enterprise implementations
    Given a core package imports an enterprise package
    When architecture lint checks the importer
    Then the enterprise dependency is rejected

  @unit @architecture
  Scenario: Only composition roots import feature server installers
    Given app code outside a designated runtime composition imports a feature server package
    When architecture lint checks the importer
    Then the server dependency is rejected
    And the diagnostic names the app or worker composition directory as the allowed location

  @unit @architecture
  Scenario: A relative import cannot escape its physical package
    Given feature source uses a relative path that resolves outside its package root
    When architecture lint resolves the import
    Then it reports a package escape at the importing line

  @unit @architecture
  Scenario: An undeclared package subpath is not importable
    Given a workspace package contains an internal source file
    And its export map does not expose that file
    When a consumer imports the internal subpath
    Then architecture lint reports a sealed-export violation

  @unit @architecture
  Scenario: Wildcard exports are forbidden for feature packages
    Given a feature package export map contains a wildcard subpath
    When architecture lint checks its manifest
    Then it fails and asks for deliberate named entry points

  @unit @architecture
  Scenario: Prisma imports stay in concrete adapters
    Given generated Prisma code is imported outside server/src/repositories/prisma
    When architecture lint checks the source
    Then it reports a Prisma-containment violation

  @unit @architecture
  Scenario: Prisma cannot leak through public declarations
    Given a package's emitted declaration mentions Prisma or a generated client path
    When architecture lint checks the public declarations
    Then it reports the exported declaration and fails

  @unit @architecture
  Scenario: Feature services are classes
    Given a feature server service module
    When it declares a standalone service factory or a service class without static create
    Then Oxlint rejects the service module

  @unit @architecture
  Scenario: Feature server control flow remains explicit
    Given a feature server object uses a conditional spread or nested ternary
    When Oxlint checks the source
    Then it rejects the hidden control flow

  @unit @architecture
  Scenario: Feature packages receive validated environment configuration
    Given feature production source reads process.env or import.meta.env
    When Oxlint checks the source
    Then it rejects the direct environment access

  @unit @architecture
  Scenario: Every feature package owns a complete architecture record
    Given a governed package root is missing its ADR index, boundary ADR, feature spec, or a required concern
    When architecture lint checks the workspace
    Then it reports an architecture-record violation
    And placeholder text does not satisfy a required section
    And an explicitly documented not-applicable concern is accepted

  @integration @architecture
  Scenario: Repository lint includes package architecture
    Given the monorepo contains nested feature packages
    When the repository lint command runs
    Then architecture lint checks every discovered feature surface
    And any violation causes the command to exit non-zero
