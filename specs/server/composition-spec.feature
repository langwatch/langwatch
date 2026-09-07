# The composition specification. See dev/docs/adr/133-composition-spec.md.
#
# One feature installer, one construction path, explicit lifecycle. A feature
# declares what it needs; boot validates and constructs; start serves. Imports
# and constructors never start background work.
#
# Accepted app factory target: serverFeature(...).withApp(ServerApp), with
# static contract, dependencies and create on the server class. Scenarios tagged
# @unimplemented describe the agreed API still to be built. Transports declare
# an apis array with router on both protocols; namespaces derive from the owner.

Feature: Composing a process from feature installers
  Every process installs the same features the same way, validates the whole
  graph before it serves, and closes what it opened in reverse order.

  Rule: a declaration is validated before anything is constructed

    @unit
    Scenario: Installing the same feature twice fails the boot
      Given an application root that declares a feature
      When the same feature is declared a second time
      Then boot fails naming the feature and the token it provides twice
      And no service of that feature is constructed

    @unit
    Scenario: A feature whose dependency nobody provides never serves
      Given a feature that requires a peer app contract
      And an application root where no installed feature provides it
      When the application boots
      Then boot fails naming the feature, the dependency key and the token
      And the process never becomes ready
      And no transport accepts a request

  Rule: the server app class owns its factory and dependency declaration

    @unimplemented @unit
    Scenario: The framework supplies declared dependencies to the app factory
      Given an annotation server app linked to its portable app contract
      And its dependency map declares project and organization app contracts
      And the process installs providers for both contracts
      When the process boots with the annotation server app selected through withApp
      Then its static create factory receives the resolved project and organization apps
      And the factory is called once with typed infrastructure and validated config
      And the returned object is registered under the linked annotation app contract
      And no separate setup, dependency map or provider declaration is required on the installer

    @unimplemented @typecheck
    Scenario: Dependency member types are derived from the declared tokens
      Given an app factory context typed from its declared dependency map
      When the factory reads its declared projects dependency
      Then its type is the project app contract without a handwritten dependency type mirror
      And accessing an undeclared users dependency fails type checking
      And supplying an incompatible factory context fails type checking

    @unimplemented @typecheck
    Scenario: A factory must return its linked app contract
      Given a server app linked to an annotation contract with queues and annotations members
      When its factory returns an object missing queues
      Then selecting that server app through withApp fails type checking

    @unimplemented @unit
    Scenario: App dependencies are validated before any factory runs
      Given server apps whose declared dependency maps contain a cycle
      When the process boots
      Then boot fails naming the dependency cycle
      And no app factory is called

    @unimplemented @architecture
    Scenario: Construction stays outside the portable contract
      Given an annotation app contract consumed by another feature and the browser
      When architecture boundaries are checked
      Then the contract imports no server implementation or infrastructure
      And the static factory and its dependency metadata belong to the owning server implementation
      And the public app instance exposes only its readonly service members

  Rule: transports declare routers and use the installed app

    @unimplemented @unit
    Scenario: Both API protocols mount from one transport declaration
      Given the annotation feature attaches a transport with REST and tRPC APIs
      And each API declaration supplies its router through the router property
      When the API process boots and starts
      Then the REST router mounts at /api/v1/annotations
      And the tRPC router mounts under annotations
      And both routers receive the exact annotation app constructed at boot
      And the feature declares no namespace or base path

    @unimplemented @typecheck
    Scenario: A router cannot attach to an incompatible app
      Given a router whose app contract requires annotation queues
      When its transport is attached to an app without that contract
      Then type checking rejects the attachment

    @unimplemented @architecture
    Scenario: Domain dependencies cannot leak into API declarations
      Given a REST or tRPC API declaration
      When it declares dependencies, create or an app selector callback
      Then the declaration is rejected with guidance to use app services and standard request context

    @unimplemented @unit
    Scenario: Route discovery needs no running application
      Given annotation REST and tRPC router declarations
      And no database or app instances have been constructed
      When the process discovers routes and generates API metadata
      Then discovery succeeds without invoking an app factory or accessing a service

    @unimplemented @integration
    Scenario: Shared app injection preserves principal and tenant checks
      Given a principal authorised for project A but not project B
      When that principal requests an annotation operation on project B through either protocol
      Then access is denied using the actual principal and target project
      And no annotation data is read or mutated for project B

  Rule: singular catalogue owners determine plural public namespaces

    @unimplemented @typecheck @unit
    Scenario Outline: Types and runtime derive the same namespace
      Given the catalogue feature name <feature>
      When its transport is attached without a namespace override
      Then its inferred namespace literal type is <namespace>
      And the runtime namespace is <namespace>
      And its REST root is /api/v1/<namespace>
      And its tRPC namespace is <namespace>

      Examples:
        | feature    | namespace   |
        | annotation | annotations |
        | query      | queries     |
        | gateway    | gateways    |
        | api-key    | api-keys    |
        | analytics  | analytics   |
        | presence   | presence    |

    @unimplemented @typecheck
    Scenario: Plural feature names cannot bypass catalogue ownership
      Given annotation is a catalogue owner and annotations is not
      When a declaration calls serverFeature with annotations
      Then type checking rejects the feature name

    @unimplemented @unit
    Scenario: Untyped feature names are validated before construction
      Given an untyped declaration with a feature name absent from the catalogue
      When the process validates its graph
      Then validation fails naming the unknown feature
      And no app factory or router mount runs

    @unimplemented @typecheck @unit
    Scenario: Every catalogue owner has matching type and runtime derivation
      Given all core and Enterprise catalogue feature names and the central exception table
      When namespace derivation is checked for every owner
      Then each runtime namespace agrees with its inferred literal type
      And regular names need no explicit namespace mapping
      And exception types derive from the same exception values used at runtime

    @unimplemented @unit
    Scenario: Derived namespace collisions fail before mounting
      Given two selected catalogue owners derive the same public namespace
      When the process validates its graph
      Then validation fails naming both owners and the conflicting namespace
      And no app factory or router mount runs

    @unimplemented @architecture
    Scenario: Feature declarations cannot override derived addressing
      Given a feature transport or API declaration
      When it supplies a namespace override or repeats the process API prefix
      Then the declaration is rejected with guidance to derive addressing from the feature owner

    @unimplemented @integration
    Scenario: A published legacy address uses an explicit compatibility alias
      Given a published annotation address differs from its canonical address
      And the process migration boundary declares a compatibility alias
      When a client uses either address
      Then both reach the same app services with the same authorisation and response contract
      And the alias does not construct a second app or change the feature namespace

  Rule: a feature publishes one app containing its public services

    @unit
    Scenario: The provided app is the setup result
      Given a feature whose setup returns its canonical app
      When that feature is installed
      Then the provider and transport contributions receive that exact app
      And its services are not constructed again

    @unit
    Scenario: A feature cannot publish a second provider
      Given a feature that already provides its app
      When another provider is declared on that feature
      Then the declaration fails with a correction naming readonly app members

    @unit
    Scenario: A task uses the app without starting transport or background work
      Given a feature with transport dependencies and worker contributions
      When the feature is installed in the task role
      Then its app is constructed once
      And no transport dependency is needed
      And no transport or worker contribution runs

  Rule: a role installs only the work that role owns

    @unit
    Scenario: The API role installs no event consumers
      Given an API process composed with its own Eventing runtime
      When a pipeline carrying a process manager is registered
      Then the pipeline is registered so its commands still send
      And the process manager is declined rather than run
      And asking the runtime for a process runtime refuses as producer-only

    @unit
    Scenario: The worker installs each feature consumer exactly once
      Given a worker application with one feature installer
      When two starts race against each other
      Then the installer installs once
      And both callers share the one started application

    @unit
    Scenario: Both transports answer from one constructed service
      Given a feature exposing one operation over REST and over tRPC
      When each door serves a request for that operation
      Then both reach the same service instance the setup constructed
      And neither door constructs a service of its own

    @unit
    Scenario: The browser application installs one session for every feature
      Given the standing declaration apps/ui serves itself
      When the installed features are read
      Then one session is installed for the whole application
      And each feature mounts its own transport provider over it

    @unit
    Scenario: One declaration contributes to API and worker roles
      Given a feature declaring both transports and background work
      When it boots in the API role
      Then only its transport contributions are constructed
      And reading its worker contribution fails explicitly
      When it boots in the worker role
      Then its worker contribution is constructed once
      And repeated contribution reads return the same instance
      And reading its transport contributions fails explicitly

  Rule: a lifecycle that fails cleans up what it acquired

    @unit
    Scenario: A failed installation closes what was already installed
      Given a worker application with two feature installers
      And the second installer fails
      When the application starts
      Then the start fails
      And the feature installed first is closed

    @unit
    Scenario: Shutdown drains in-flight work before releasing infrastructure
      Given a worker application serving feature consumers
      When the application closes
      Then Eventing drains first
      And the features close after the drain
      And the runtime infrastructure is released last

    @unit
    Scenario: Failed setup or transport assembly awaits all acquired resources
      Given setup registers a resource before returning its app
      When setup or transport construction fails
      Then the current feature and prior features close in reverse acquisition order
      And boot rejects only after cleanup finishes
      And cleanup failures retain the construction failure as their cause

    @unit
    Scenario: Failed start rolls back partial work and shutdown continues after failures
      Given two runtime services and owned feature resources
      When the second service fails during start
      Then both attempted services stop in reverse order
      And feature resources close after the services
      And the start failure is preserved
      And repeated shutdown does not close anything twice
      And failures during shutdown do not skip earlier resources

  Rule: a blocking migration gates readiness, and resumable work resumes

    @unimplemented @integration
    Scenario: A blocking startup migration holds every replica out of readiness
      Given a migration declared to block startup
      And several replicas booting against one database
      When the migration has not finalized for every tenant in its cohort
      Then no replica reports ready
      And a replica whose pass failed, parked, or was intervened on stays unready
      And readiness opens only once completion is asserted, not once movement stops

    @unit
    Scenario: A restart skips the tenants an earlier pass finalized
      Given a tenant recorded as finalized by an earlier pass
      When a later pass runs
      Then the migration is never called for that tenant

    @unit
    Scenario: A background migration resumes from its persisted checkpoint
      Given a tenant whose previous attempt parked partway
      When the next pass runs
      Then the migration receives that record
      And it continues the stranded work rather than starting again
