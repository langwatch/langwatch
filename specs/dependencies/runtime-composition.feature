# See ../../dev/docs/adr/102-runtime-composition-roots.md
# See ../../dev/docs/adr/111-physical-application-workspaces.md

Feature: App and worker runtime encapsulation
  As a platform maintainer
  I want separate API and worker compositions with an explicit development parent
  So that each process loads and owns only the services it runs

  @architecture @typecheck
  Scenario: The interactive app has a closed capability graph
    Given the app feature catalogue has been selected
    When createApp builds the interactive runtime
    Then every required service capability is satisfied
    And the service registry is sealed before HTTP starts
    And no worker consumer, scheduler or process manager is started

  @architecture @typecheck
  Scenario: The worker has a closed capability graph
    Given the worker feature catalogue has been selected
    When createWorker builds the background runtime
    Then every required service capability is satisfied
    And no React source, internal RPC router, legacy REST router or realtime server is loaded

  @unit @architecture
  Scenario: Missing feature requirements fail during build
    Given an installed feature requires a capability no selected feature provides
    When the runtime is built
    Then build fails naming the feature and missing capability
    And no transport begins accepting work

  @unit @architecture
  Scenario: Duplicate capability providers fail during build
    Given two installed features provide the same capability key
    When the runtime is built
    Then build fails naming both providers
    And neither silently replaces the other

  @unit @architecture
  Scenario: A built registry cannot be mutated
    Given a runtime has completed feature installation
    When code tries to install or replace a capability
    Then the operation is rejected

  @architecture @registration
  Scenario: Feature imports have no registration side effects
    Given an app or worker imports a feature server package
    Then no route, queue consumer, subscriber or scheduler is registered
    When a runtime calls a selected feature installer
    Then only that installer's declared contributions are added

  @integration @runtime
  Scenario: Standalone runtimes own their infrastructure
    Given app and worker run in separate processes
    When each runtime is created
    Then each owns the infrastructure clients it requested
    And closing one runtime does not depend on the other process

  @integration @runtime
  Scenario: Combined development mode shares infrastructure explicitly
    Given development hosts app and worker in one process
    When tools/dev-runtime builds both runtimes
    Then app and worker are distinct child compositions
    And their shared infrastructure is owned by the combined parent

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

  @integration @rpc
  Scenario: RPC is the standard Agents product interface
    Given Agents is installed in the interactive app
    When the internal RPC router is composed
    Then the Agents RPC operations are mounted from the feature adapter
    And the browser client uses those operations for new product behaviour

  @unit @rpc
  Scenario: RPC handlers use the request application from context
    Given the request context contains an already-instantiated application service graph
    When an Agents RPC handler runs
    Then it calls the Agents service on the request application
    And it does not construct a service or repository inside the handler
    And a test may provide a small fake request application

  @integration @rest
  Scenario: Legacy Agents REST remains operational and visibly deprecated
    Given the Agents RPC interface is installed
    And an existing client calls the Agents REST interface with valid credentials
    When the request is handled
    Then it reaches the same Agents service operation as RPC
    And the response remains compatible
    And OpenAPI marks the operation deprecated and labels it Legacy

  @integration @rest
  Scenario: Deprecation does not relax Legacy REST guarantees
    Given an Agents REST operation is deprecated
    When an unauthorized or invalid request reaches it
    Then authentication, project authorization and contract validation still apply
    And the operation remains covered by compatibility tests

  @architecture @environment
  Scenario: Each runtime validates its environment once
    Given app and worker have separate T3 environment schemas with a small shared base
    When a runtime composition is created
    Then its environment is validated before feature services are constructed
    And each feature receives only its narrow typed configuration
    And feature packages do not read process.env, import.meta.env or the app env module

  @unit @environment
  Scenario: Importing application configuration has no validation side effect
    Given an executable has not started its boot path
    When application environment and configuration modules are imported
    Then no environment source is read or validated
    And reading the transitional environment bridge refuses with a boot-boundary error
    When executable boot initializes the bridge from its selected source
    Then legacy readers observe that validated configuration without validating it again

  @architecture @environment
  Scenario: JavaScript runtimes share configuration mechanics but not one schema
    Given the app, worker, and standalone services have different configuration requirements
    When each runtime builds its Zod configuration schema
    Then each uses the shared JavaScript configuration package
    And no runtime is forced to declare another runtime's settings
    And no shared object grants features access to every environment value

  @integration @environment
  Scenario: Browser runtime configuration is semantic and embedded at page load
    Given the browser needs non-secret deployment configuration
    When the app or development UI runtime serves the HTML shell
    Then the shell embeds only contract-defined semantic fields as inert data
    And it exposes no secret or raw environment-variable name
    And the browser renders without a configuration request
    And caller-specific capabilities are resolved by a separate viewer query
    And an anonymous authentication capability query exposes only the sign-in mode
