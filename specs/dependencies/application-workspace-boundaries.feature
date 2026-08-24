# See ../../dev/docs/adr/111-physical-application-workspaces.md
# Complements runtime-composition.feature, which owns
# capability-graph construction, lifecycle and combined-development behaviour.
# Detailed compatibility remains owned by ../server/prisma-driver-adapter.feature,
# ../server/redis-client-ownership.feature, ../server/spa-fallback.feature,
# ../server/cdn-asset-base.feature, ../setup/single-pnpm-workspace.feature and
# ../npx-installer/05-publish.feature.
# Enterprise package shape remains owned by
# ../../packages/architecture-lint/specs/feature-package-boundaries.feature and
# ../../packages/architecture-lint/specs/strict-feature-layout.feature.
# License and plan behaviour remains owned by
# ../../packages/features/entitlements/specs/entitlement-resolution.feature and
# ../licensing/license-validation.feature. Locked capability discovery remains
# owned by ../licensing/self-hosted-enterprise-discovery.feature.
# Repository lint and format migration is owned by oxc-toolchain.feature.

@unimplemented
Feature: Physical application workspace boundaries
  As a platform maintainer
  I want UI, API, worker and self-host execution in separate workspace packages
  So that each executable has an enforceable dependency graph without changing how LangWatch is deployed

  Rule: Every executable has one truthful application package

    @architecture @typecheck
    Scenario: The repository exposes four application workspaces
      Given the physical application split is complete
      When the pnpm workspace packages are inspected
      Then apps/ui is the @langwatch/ui package
      And apps/api is the @langwatch/platform-api package
      And apps/worker is the @langwatch/worker package
      And apps/server is the @langwatch/server package
      And platform/app no longer exists

    @architecture @packaging
    Scenario: The repository root is not the published server package
      Given the application workspaces have been created
      When the root and server manifests are inspected
      Then the repository-root manifest is private
      And apps/server owns the publishable @langwatch/server manifest and binary
      And contributor commands at the root delegate to the owning workspace package

    @architecture @typecheck
    Scenario: Application packages are composition roots rather than shared libraries
      Given UI, API, worker and server need reusable behaviour
      When their source dependencies are inspected
      Then no application imports another application's source
      And no apps/shared package exists
      And shared product behaviour comes from its owning feature contract or implementation package
      And shared infrastructure comes from a deliberately named package

    @architecture @development @typecheck
    Scenario: Combined development is a contributor composition rather than an application dependency
      Given local development hosts API and worker in one process
      When the combined runtime dependency graph is inspected
      Then tools/dev-runtime is a private contributor workspace package
      And it imports the intentional API and worker runtime construction entry points
      And API and worker do not depend on one another
      And no other tool or application may import both runtime entry points
      And tools/dev-runtime contains no product service, repository, route, consumer or job implementation

  Rule: Browser and interactive server graphs are physically separate

    @architecture @web @typecheck
    Scenario: The UI package is browser safe
      Given the UI composes product screens
      When its production dependency graph is checked
      Then it may depend on feature contracts, feature web packages, the Design System and browser-safe API clients
      And it imports no Node runtime, Prisma client, feature server, API application, worker application or server launcher source

    @architecture @trpc @typecheck
    Scenario: Browser typing does not evaluate the tRPC server router
      Given the UI calls an existing application tRPC procedure
      When its client input and output types are resolved
      Then those types come from a portable browser-safe contract
      And a feature-owned procedure gets those types from its feature contract
      And a not-yet-extracted procedure gets them from the temporary @langwatch/platform-api-contract package
      And the UI does not import AppRouter or another declaration from the API implementation
      And a type-only import is not accepted as an application boundary

    @architecture @trpc @migration
    Scenario: The temporary API contract cannot drift from the router
      Given a legacy application procedure is represented by @langwatch/platform-api-contract
      When the API contract conformance check compares it with the implemented tRPC router
      Then every public procedure input and output remains compatible
      And the contract imports no router, handler or API implementation declaration
      And a mismatch fails before the UI or API is built

    @architecture @api @typecheck
    Scenario: The API package owns only the interactive process
      Given the API application is built
      Then it composes Hono APIs, application tRPC, authentication and realtime transports
      And it uses @langwatch/api as its reusable Hono service framework
      And it starts no queue consumer, process manager, scheduler or one-shot product task
      And it imports no UI source or worker application source

    @architecture @worker @typecheck
    Scenario: The worker package owns background execution
      Given the worker application is built
      Then it composes Eventing and Group Queue consumers, process managers and schedulers
      And one-shot product tasks are worker entry points
      And it imports no React source, browser state, Hono route composition, tRPC router or static asset server

    @architecture @server @typecheck
    Scenario: The server package remains a launcher rather than a backend library
      Given @langwatch/server is installed
      When its source and public exports are inspected
      Then it owns installation, local dependency management, packaging, process supervision and stack health
      And it invokes built API, worker and task entry points
      And it implements no product API, product job, repository, projection or database migration

  Rule: Enterprise code follows the same strict feature ownership

    @architecture @enterprise @typecheck
    Scenario: Enterprise has one portable root package and one legal license boundary
      Given enterprise packages are installed
      When the packages/enterprise ownership root is inspected
      Then its LICENSE.md is the LangWatch Enterprise License
      And that notice governs every file and package below the root
      And its README explains the open-core split and catalogues the features
      And its root manifest is the @langwatch/enterprise package
      And the root package owns only the portable enterprise catalogue
      And the root package imports no enterprise feature implementation, React, Node runtime, transport or persistence adapter
      And source archives and staged distributions retain the root notice

    @architecture @enterprise @typecheck
    Scenario: Each runtime has one convenient enterprise composition package
      Given UI, API and worker each install enterprise capabilities
      When their application composition dependencies are inspected
      Then UI imports @langwatch/enterprise-web
      And API imports @langwatch/enterprise-api
      And worker imports @langwatch/enterprise-worker
      And each composition package exports a class with static create
      And no application maintains a second list of individual enterprise feature implementations

    @architecture @enterprise @typecheck
    Scenario: Enterprise grouping does not merge runtime dependency graphs
      Given the three enterprise composition packages
      When architecture lint checks their manifests, imports and declarations
      Then the web composition imports only portable contracts and enterprise web surfaces
      And the API composition imports only portable contracts and enterprise API or server installers
      And the worker composition imports only portable contracts and enterprise worker or server installers
      And no composition package imports either of the other two composition packages

    @architecture @enterprise @typecheck
    Scenario: Enterprise features use the strict version-zero package layout
      Given reusable enterprise product behaviour is extracted from platform/app/ee
      When its ownership root is inspected
      Then it lives under packages/enterprise/features/<feature>
      And its contract, server and optional web surfaces are separate workspace packages
      And its package names use the @langwatch/enterprise-<feature>-<surface> form
      And it obeys the same class, filename, repository and public-export rules as a core feature
      And product licensing lives at packages/enterprise/features/licensing rather than in an aggregate package

    @architecture @enterprise @licensing
    Scenario: Signed licenses feed rather than replace provider-neutral entitlements
      Given enterprise availability may come from SaaS plan state or a signed self-host license
      When an enterprise operation evaluates whether a capability may be used
      Then signed-license validation is provided by the strict enterprise licensing feature
      And the final availability decision uses the provider-neutral Entitlements contract
      And no enterprise feature assumes every Enterprise customer has a signed license

    @integration @enterprise @licensing
    Scenario: Unlicensed self-hosted deployments retain enterprise discovery
      Given the distribution contains the enterprise composition and feature packages
      And the deployment has no Enterprise entitlement
      When enterprise surfaces are registered
      Then locked capability discovery remains available as specified by the licensing feature
      And protected enterprise operations remain unavailable
      And entitlement affects use rather than whether the source package was installed

    @architecture @enterprise @typecheck
    Scenario: The application no longer contains an unstructured EE source tree
      Given the physical application split is complete
      When enterprise-owned source and import aliases are inspected
      Then platform/app/ee does not exist
      And no @ee import alias exists
      And no apps/ui/ee, apps/api/ee, apps/worker/ee or apps/server/ee directory exists
      And no catch-all enterprise implementation or legacy package replaces them
      And no core package imports an enterprise implementation

    @integration @enterprise @deployment
    Scenario: Moving EE source does not change enterprise availability
      Given the current image and self-host distribution include enterprise behaviour
      When that behaviour moves into strict enterprise feature packages
      Then the same selected packages are staged into the existing distribution
      And packages/enterprise/LICENSE.md and README.md are staged above them
      And licensing and deployment topology remain unchanged

  Rule: UI hosting remains compatible while source ownership separates

    @integration @web @packaging
    Scenario: The production API serves the built UI artifact
      Given the production image contains the UI and API build artifacts
      When a browser requests a product route from the API origin
      Then the API serves the UI shell and existing single-page fallback
      And the API consumes an artifact location rather than importing UI source
      And the detailed static, cache, CDN and security behaviour remains owned by the existing server specifications

    @integration @development
    Scenario: Development keeps the UI and API processes separate
      Given a developer starts the combined local experience
      When the UI requests an API path
      Then the Vite development server proxies that request to the API process
      And browser navigation remains on the UI origin
      And the API does not start a second browser build

  Rule: Process configuration remains explicit while the UI stays environment-free

    @architecture @configuration @typecheck
    Scenario: Process applications validate only their own environment
      Given API, worker and server are composed independently
      When each process validates its environment
      Then each uses its own runtime environment schema
      And none imports another application's environment schema
      And UI owns no deployment environment schema or secret
      And UI receives allow-listed public runtime configuration from the API

    @integration @development
    Scenario: Contributor environment files survive removal of the monolithic package
      Given a contributor uses quickstart, Haven or a root development command
      When platform/app is removed
      Then the repository-root .env is the contributor source of truth
      And generated development overrides are written to repository-root .env.dev-up
      And each selected process validates only its subset of the loaded source

  Rule: Prisma is an explicitly owned infrastructure client

    @architecture @prisma @typecheck
    Scenario: One Prisma client package owns the relational substrate
      Given PostgreSQL persistence is used by application and feature code
      When Prisma-owned files are located
      Then packages/prisma-client is the @langwatch/prisma-client package
      And it owns the canonical schema, PostgreSQL migrations, generated client and PostgreSQL driver adapter
      And it owns client construction, readiness, shutdown, migration and seed mechanics
      And no application contains a second Prisma schema, migration tree or generated client

    @unit @prisma
    Scenario: Importing the Prisma client package has no process side effects
      Given a process has not composed its infrastructure
      When it imports @langwatch/prisma-client
      Then no database connection is created
      And no environment variable is read
      And no ready-made client, lazy proxy or module singleton is exported

    @architecture @prisma @typecheck
    Scenario: Product behaviour does not move into the Prisma client package
      Given a feature persists relational state
      When its dependency graph is inspected
      Then only its concrete server/src/repositories/prisma adapter may import @langwatch/prisma-client/generated
      And the feature service depends on its narrow repository capability
      And @langwatch/prisma-client contains no product query, repository or business rule
      And contract and web packages do not import @langwatch/prisma-client
      And no product package re-exports the generated Prisma surface

    @integration @prisma @runtime
    Scenario: Standalone processes own separate Prisma clients
      Given API and worker run as separate processes
      When each runtime composes its infrastructure
      Then each creates one Prisma client from its own validated configuration
      And each closes its client through its own resource scope
      And closing one process does not depend on the other process

    @integration @prisma @runtime
    Scenario: Combined development shares Prisma explicitly
      Given local development hosts API and worker in one process
      When tools/dev-runtime composes shared infrastructure
      Then API and worker receive the same Prisma client intentionally
      And the parent resource scope closes that client exactly once

  Rule: Physical extraction preserves the deployed system

    @integration @deployment
    Scenario: API and worker remain commands in the same image
      Given the application workspace split has been released
      When the production image is inspected
      Then it contains the built UI, API and worker artifacts
      And its default command starts the API
      And its worker command starts the worker
      And no additional image is required by the source split

    @integration @deployment
    Scenario: No new network service is required
      Given a deployment worked before the application workspace split
      When the same Docker Compose or Helm configuration runs the split artifacts
      Then the existing API and worker process topology is used
      And no new ingress, service, hostname or inter-feature network call is required

    @integration @packaging
    Scenario: The self-host command remains compatible
      Given an operator uses npx @langwatch/server
      When the split release is installed and started
      Then the same public package and binary launch the self-host stack
      And the launcher resolves the built API, worker and task artifacts from the staged distribution
      And the nested staged workspace retains its frozen lockfile install
      And first boot installs the @langwatch/server workspace closure
      And the operator is not required to install a renamed package

    @architecture @build
    Scenario: Each application graph can be checked independently
      Given the four application manifests and their workspace dependencies
      When a maintainer filters install, typecheck, test or build to one application
      Then only that application and its declared package dependencies are selected
      And checking the UI does not evaluate API or worker implementation source
      And checking the worker does not evaluate UI or API transport source

  Rule: Migration stages remain runnable and temporary seams disappear

    @architecture @migration
    Scenario: Migration lint prevents new debt while allowing the baseline to shrink
      Given platform/app still contains legacy application-boundary edges
      And those exact edges are recorded in the checked-in migration baseline
      When architecture lint checks the repository
      Then an existing recorded edge may remain temporarily
      And a new cross-application edge, apps/shared directory or @ee import is rejected
      And removing an edge requires removing its baseline entry
      And the completed split has no migration baseline

    @architecture @migration
    Scenario: Product behaviour moves vertically before its application root
      Given reusable product behaviour still lives inside platform/app
      When its owning feature is extracted
      Then portable schemas and capabilities move to the feature contract
      And backend services and adapters move to the feature server package
      And browser behaviour moves to the feature web package when present
      And route, consumer and task installers move with the owning feature
      And the still-runnable application consumes those package exports
      And no application root becomes a replacement product implementation package

    @integration @migration
    Scenario: Every extraction stage preserves supported entry points
      Given one planned extraction stage has been applied
      When the repository runs its supported development, production and self-host checks
      Then the API, worker and self-host entry points remain runnable
      And the production API still serves the UI artifact
      And no deployment topology change is required to adopt that stage

    @architecture @migration
    Scenario: Retiring the monolithic package leaves no compatibility layer
      Given the last supported caller has moved out of platform/app
      When platform/app is removed
      Then no forwarding package, source alias or duplicate runtime composition preserves it
      And no platform/app/ee directory or @ee import alias remains
      And no UI-to-server AppRouter import remains
      And the temporary @langwatch/platform-api-contract package is removed after its last legacy procedure moves
      And root scripts, environment files, CI, Docker, Helm, generated-file checks and npm staging name the owning application packages
      And the detailed runtime, Prisma, Oxc, static-delivery and npx contracts name their replacement paths
