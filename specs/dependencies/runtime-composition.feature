# See ../../dev/docs/adr/102-runtime-composition-roots.md
# See ../../dev/docs/adr/111-physical-application-workspaces.md

Feature: App and worker runtime encapsulation
  As a platform maintainer
  I want separate API and worker compositions with an explicit development parent
  So that each process loads and owns only the services it runs

  @integration @shutdown
  Scenario: Combined shutdown drains work before closing shared clients
    Given combined development mode is running
    When the process begins graceful shutdown
    Then HTTP stops accepting new requests
    And worker activity drains before Redis, ClickHouse and Prisma close
    And every shared client is closed exactly once

  @architecture @migration
  Scenario: New features do not use the global App singleton
    Given a feature is implemented as a physical package
    When its service and runtime adapters are composed
    Then all required capabilities are passed explicitly
    And the feature source does not import getApp, initializeDefaultApp or AppDependencies

  @architecture @environment
  Scenario: Each runtime validates its environment once
    Given app and worker have separate T3 environment schemas with a small shared base
    When a runtime composition is created
    Then its environment is validated before feature services are constructed
    And each feature receives only its narrow typed configuration
    And feature packages do not read process.env, import.meta.env or the app env module

  @architecture @environment
  Scenario: JavaScript runtimes share configuration mechanics but not one schema
    Given the app, worker, and standalone services have different configuration requirements
    When each runtime builds its Zod configuration schema
    Then each uses the shared JavaScript configuration package
    And no runtime is forced to declare another runtime's settings
    And no shared object grants features access to every environment value
