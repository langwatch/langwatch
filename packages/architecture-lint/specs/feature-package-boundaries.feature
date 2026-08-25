# See ../adrs/001-feature-package-boundaries.md

Feature: Feature package boundary lint
  As a monorepo maintainer
  I want package architecture checked like source code
  So that feature boundaries cannot be bypassed by imports or exported types

  @unit @architecture
  Scenario: A valid feature graph passes
    Given a singular feature and its subjects are registered in the ownership catalogue
    And it has a contract package with portable dependencies
    And server and web packages that depend on their own contract
    And another feature is referenced only through its contract
    When architecture lint checks the fixture workspace
    Then no violation is reported

  @unit @architecture
  Scenario: Architecture lint stays on structural facts
    Given routine dependency upgrades, formatting, and subjective implementation style are checked elsewhere
    When architecture lint checks the workspace
    Then it checks ownership, package roles, services, repositories, persistence containment, and durable-processing safety
    And it rejects package runtimes that the architecture has explicitly retired

  @unit @architecture
  Scenario: Legacy edge reconciliation stays out of the hot path
    Given the temporary application split has a checked-in shrinking edge baseline
    When routine architecture lint checks the workspace
    Then it does not rebuild the legacy baseline
    And the explicit migration audit reconciles stale and newly added legacy edges

  @unit @architecture
  Scenario: Legacy feature fragments only shrink
    Given a migrated feature has remaining path-shaped implementation, transport, composition, page-shell, or infrastructure-adapter modules in platform/app
    And those exact modules are recorded in the checked-in feature fragment inventory
    When architecture lint checks the workspace
    Then a new module matching a catalogue-owned subject is rejected
    And a removed inventory module is reported as stale
    And inventory ordering and duplicate feature/file entries are rejected

  @unit @architecture
  Scenario: Physical package names match their feature roles
    Given a feature surface package name does not match its registered singular identifier, path and role
    When architecture lint checks the workspace
    Then it fails with the expected package name and manifest path

  @unit @architecture
  Scenario: A broad feature cannot silently acquire a new subject
    Given the central ownership catalogue assigns each product subject to one feature
    And contract or server source introduces a filename outside those subjects
    When architecture lint checks the workspace
    Then it reports a feature-source-subject violation
    And adding that subject to feature.json does not suppress the violation
    And a catalogue expansion requires the owning feature ADR and spec

  @unit @architecture
  Scenario: Two features cannot own the same subject
    Given the ownership catalogue assigns one product subject to two feature roots
    When architecture lint checks the workspace
    Then it reports both conflicting owners
    And neither feature is accepted as the implicit winner

  @unit @architecture @enterprise
  Scenario: Enterprise aggregate packages have fixed roles and names
    Given the portable enterprise root and API, worker and web composition packages
    When architecture lint checks their paths, manifests and exports
    Then each has the package name and dependency role fixed by ADR-111
    And packages/enterprise/LICENSE.md exists above every enterprise source package
    And the root manifest identifies that Enterprise license
    And no descendant manifest claims that enterprise source is Apache-2.0
    And no aggregate manifest is accepted outside the fixed root, composition and feature-surface paths

  @unit @architecture @enterprise
  Scenario: Enterprise composition packages preserve runtime graphs
    Given an enterprise composition package imports another composition role or an incompatible feature surface
    When architecture lint checks the package
    Then it reports the cross-runtime dependency
    And it identifies the compatible enterprise surface for that composition role

  @unit @architecture
  Scenario: Contract production code cannot acquire runtime implementations
    Given contract source imports React, Node, Prisma, server or web code
    When architecture lint checks the package
    Then each forbidden dependency is reported

  @unit @architecture
  Scenario: Feature contracts remain transport-neutral
    Given governed feature source imports a Hono-specific Zod adapter
    When architecture lint checks the package
    Then it rejects the import
    And directs the feature to Standard Schema

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
    Given code outside an application or enterprise composition root imports a feature server package
    When architecture lint checks the importer
    Then the server dependency is rejected
    And the diagnostic names the compatible application or enterprise composition directory as the allowed location

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
  Scenario: A root barrel cannot disguise private persistence
    Given a feature server root re-exports a repository, store, or projection
    When architecture lint checks the source layout
    Then it rejects the private runtime export
    And ordinary consumers remain limited to the feature service contract

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
    When it exports a standalone service factory or a service class without static create
    Then Oxlint rejects the service module

  @unit @architecture
  Scenario: Feature classes may use private pure helpers
    Given a feature service class uses a private pure module-local function
    When Oxlint checks the service module
    Then it accepts the helper as an implementation detail

  @unit @architecture
  Scenario: Services do not reach through another domain's repository
    Given a service imports a repository owned by another feature or legacy domain
    When Oxlint checks the service module
    Then it rejects the repository dependency
    And directs the service to depend on the owning domain's service

  @unit @architecture
  Scenario: Service dependencies are explicit domain capabilities
    Given a service imports a database client or recovers the global application graph
    When Oxlint checks the service module
    Then it rejects that hidden dependency
    And directs the service to receive its own repository or another service

  @unit @architecture
  Scenario: Feature packages use the canonical Zod 4 entry point
    Given a feature package declares Zod 3 or imports zod/v3 or zod/v4
    When architecture lint checks its manifest and source
    Then it rejects the retired or version-coupled package entry point

  @unit @architecture
  Scenario: Retired package surfaces cannot remain in application code
    Given a first-party package has been replaced by its singular feature surfaces
    When source imports the retired package name or one of its old subpaths
    Then architecture lint rejects the import
    And names the canonical contract, server, or web surface

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

  @unit @architecture
  Scenario: Test fixtures have a named non-production home
    Given a strict server package contains a lower-case kebab-case fixture under src/fixtures
    When architecture lint checks the package
    Then the fixture path is accepted
    And production consumers still use the package root instead of the testing subpath

  @integration @architecture
  Scenario: Repository lint includes package architecture
    Given the monorepo contains nested feature packages
    When the repository lint command runs
    Then architecture lint checks every discovered feature surface
    And any violation causes the command to exit non-zero
