# See ../../dev/docs/adr/111-physical-application-workspaces.md
# Complements ../../platform/app/specs/runtime-composition.feature, which owns
# capability-graph construction, lifecycle and combined-development behaviour.

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
      And the UI does not import AppRouter or another declaration from the API implementation
      And a type-only import is not accepted as an application boundary

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

  Rule: UI hosting remains compatible while source ownership separates

    @integration @web @packaging
    Scenario: The production API serves the built UI artifact
      Given the production image contains the UI and API build artifacts
      When a browser requests a product route from the API origin
      Then the API serves the UI shell and existing single-page fallback
      And static assets retain their content types, cache policy and security headers
      And the API consumes an artifact location rather than importing UI source

    @integration @development
    Scenario: Development keeps the UI and API processes separate
      Given a developer starts the combined local experience
      When the UI requests an API path
      Then the Vite development server proxies that request to the API process
      And browser navigation remains on the UI origin
      And the API does not start a second browser build

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

    @architecture @prisma @typecheck
    Scenario: Product behaviour does not move into the Prisma client package
      Given a feature persists relational state
      When its dependency graph is inspected
      Then only its concrete repositories/prisma adapter may use the generated Prisma surface
      And the feature service depends on its narrow repository capability
      And @langwatch/prisma-client contains no product query, repository or business rule
      And contract and web packages do not import @langwatch/prisma-client

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
      When the combined runtime composes shared infrastructure
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
      And existing probes, ports, environment contracts and shutdown budgets remain compatible

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
      And the operator is not required to install a renamed package

    @architecture @build
    Scenario: Each application graph can be checked independently
      Given the four application manifests and their workspace dependencies
      When a maintainer filters install, typecheck, test or build to one application
      Then only that application and its declared package dependencies are selected
      And checking the UI does not evaluate API or worker implementation source
      And checking the worker does not evaluate UI or API transport source

  Rule: Migration stages remain runnable and temporary seams disappear

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
      And no UI-to-server AppRouter import remains
      And root scripts, CI, Docker, Helm, generated-file checks and npm staging name the owning application packages
