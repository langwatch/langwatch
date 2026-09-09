# The composition specification. See dev/docs/adr/133-composition-spec.md.
#
# One feature installer, one construction path, explicit lifecycle. A feature
# declares what it needs; boot validates and constructs; start serves. Imports
# and constructors never start background work.
#
# Accepted app factory target: defineFeature(...).withApp(ServerApp), with
# static API, dependencies and create on the server class. Scenarios tagged
# @unimplemented describe the agreed API still to be built. withTransports takes
# variadic inbound declarations; namespaces derive from the owner.

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
      Given a feature that requires a peer API token
      And an application root where no installed feature provides it
      When the application boots
      Then boot fails naming the feature, the dependency key and the token
      And the process never becomes ready
      And no transport accepts a request

  Rule: the server app class owns its factory and dependency declaration

    @unimplemented @unit
    Scenario: The framework supplies declared API dependencies to the app factory
      Given an annotation server app linked to its portable callable API
      And its dependency map declares project and organization API tokens
      And the process installs providers for both contracts
      When the process boots with the annotation server app selected through withApp
      Then its static create factory receives the resolved project and organization apps
      And the factory is called once with typed infrastructure and validated config
      And the returned object is registered under the linked annotation API token
      And no separate setup, dependency map or provider declaration is required on the installer

    @unimplemented @typecheck
    Scenario: Dependency member types are derived from API tokens
      Given an app factory context typed from its declared dependency map
      When the factory reads its declared projects dependency
      Then its type is the project API without a handwritten dependency type mirror
      And accessing an undeclared users dependency fails type checking
      And supplying an incompatible factory context fails type checking

    @typecheck
    Scenario: An app must implement its linked callable API
      Given a server app linked to an annotation API with callable use cases
      When its factory returns an object missing one use case
      Then selecting that server app through withApp fails type checking

    @unit
    Scenario: Reciprocal API dependencies bind before readiness
      Given two server apps that declare each other through API tokens
      When the process boots
      Then each app is constructed once without accessing the peer
      And both APIs are bound before the process becomes ready
      And calls work in either direction after boot

    @unimplemented @unit
    Scenario: Legacy constructor dependency cycles fail before construction
      Given legacy installers whose constructor-token dependencies contain a cycle
      When the process boots
      Then boot fails naming the dependency cycle
      And no app factory is called

    @unimplemented @unit
    Scenario: A peer can depend only on a callable API token
      Given a feature with a peer feature API dependency
      When the peer is selected through the composition graph
      Then the peer service and repository remain private
      And no cross-feature service token or app lookup is available

    @unit
    Scenario: Incomplete API bindings fail before publication
      Given a graph whose app reads or calls a peer before peer binding completes
      When boot constructs the graph
      Then boot fails with a named early-access error
      And no incomplete app is published

    @unimplemented @architecture
    Scenario: Construction stays outside the portable contract
      Given an annotation API consumed by another feature and the browser
      When architecture boundaries are checked
      Then the contract imports no server implementation or infrastructure
      And the static factory and its dependency metadata belong to the owning server implementation
      And the public app instance exposes only callable API methods

  Rule: in-process clients forward typed calls without a transport boundary

    @unit
    Scenario: Local forwarding preserves application values and errors
      Given a booted feature with a typed in-process client
      When a caller invokes an API operation with a domain value
      Then the App receives the same argument instance
      And the caller receives the same result or promise instance
      And a thrown domain error reaches the caller unchanged
      And the operation retains the App as its receiver
      And no serialization or inbound auth or schema middleware runs

    @unit
    Scenario: Client reflection cannot expose application internals
      Given an App with private state and an implementation getter
      When a caller probes the getter or Object prototype methods through its client
      Then the getter is not evaluated
      And the underlying App is not returned

    @unit
    Scenario: Retained clients close after startup or cleanup failure
      Given a caller retains a bound API operation
      When process startup fails or shutdown encounters a resource cleanup error
      Then the retained operation refuses further calls
      And cleanup still attempts every acquired resource

    @typecheck
    Scenario: A provided client must implement the complete interface
      Given a root providing an implementation through a feature API token
      When the root explicitly widens its generic API type to an empty object
      Then type checking rejects the incomplete implementation

  Rule: transports declare routers and use the installed app

    @unimplemented @unit
    Scenario: Both API protocols mount from direct transport declarations
      Given the annotation feature attaches REST and tRPC declarations through withTransports
      And each declaration carries its protocol and native router factory type
      And no separate wrapper or protocol helper is required at attachment
      When the API process boots and starts
      Then the REST router mounts at /api/v1/annotations
      And the tRPC router mounts under annotations
      And both routers receive the exact annotation app constructed at boot
      And the feature declares no namespace or base path

    @unimplemented @typecheck
    Scenario: A process cannot mount a router against an incompatible host
      Given a router whose app API requires annotation operations
      When its native router factory is mounted against a host without that contract
      Then type checking rejects the mount

    @unimplemented @architecture
    Scenario: Domain dependencies cannot leak into API declarations
      Given a REST or tRPC API declaration
      When it declares dependencies, create or an app selector callback
      Then the declaration is rejected with guidance to use app services and the framework supplied handler arguments

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

  Rule: handler boundaries resist accidental and adversarial bypasses

    @unimplemented @integration
    Scenario Outline: Caller identity cannot replace the authenticated principal
      Given an authenticated principal with access to project A
      When a <protocol> request includes a forged actor, user identity or session
      Then the handler receives only the framework authenticated principal
      And the original principal kind and credential limits are preserved
      And no caller supplied identity becomes the author of the operation

      Examples:
        | protocol |
        | REST     |
        | tRPC     |

    @unimplemented @integration
    Scenario: A contradictory target cannot cross the authorization boundary
      Given a credential authorized for project A but not project B
      When a request names project A in its path and project B in its body
      Then the protocol either rejects the conflict or applies its documented path precedence
      And the dispatched target is exactly the target authorized by the framework
      And no read or write reaches project B

    @unimplemented @integration
    Scenario: A project key cannot inherit its owner's wider permissions
      Given a project key restricted to project A
      And its owner can administer project B
      When the key requests an operation on project B
      Then the framework denies the request before domain execution
      And the handler never receives the owner as a human principal

    @unimplemented @integration
    Scenario: An anonymous share token keeps its exact resource grant
      Given a valid share token granting anonymous access to one trace
      When the share request passes through the governed handler boundary
      Then the declared share policy permits that trace with its existing redactions
      And the handler receives no share token or raw credential
      And the same token cannot read another trace or project

    @unimplemented @integration
    Scenario: Substituting a foreign resource fails the service ownership check
      Given a request authorized for project A
      And an annotation queue item owned by project B
      When a handler dispatches that foreign item under project A
      Then the service denies the operation before any foreign data is returned or changed
      And a regression that removes the ownership predicate fails the adversarial test

    @unimplemented @typecheck @unit
    Scenario: Hidden raw context cannot survive a narrow handler type
      Given a process adapter whose actor value contains extra session and request properties
      When the framework constructs the handler arguments
      Then the actor and scope contain only their portable schema fields
      And accessing raw context, headers, session or authorization callbacks fails type checking
      And those properties are absent at runtime, including nested actor and scope values

    @unimplemented @architecture
    Scenario: A feature cannot manufacture its own trusted policy binding
      Given a feature that supplies an actor or scope resolver in a transport declaration
      When architecture boundaries are checked
      Then the declaration is rejected with guidance to use the process prepared policy binding
      And renaming or aliasing the resolver does not bypass the rule

    @unimplemented @unit
    Scenario: Declaring an output schema cannot silently disable enforcement
      Given a handler with an output schema
      When an author attempts to disable validation or omit the schema
      Then the governed declaration is rejected before serving
      And there is no withoutOutput or validation flag escape hatch

    @unimplemented @integration
    Scenario: Valid output retains its declared transforms and field removal
      Given an output schema that transforms a field and removes undeclared fields
      And a handler returning a valid value with an extra private field
      When the framework sends the response
      Then the client receives the transformed field
      And the private field is absent

    @unimplemented @integration
    Scenario: Unexpected output is diagnosed without failing the response
      Given an endpoint whose declared output requires an object with a numeric count
      And an unexpected runtime result contains a string count
      When REST or tRPC emits the result
      Then the original result is sent with the declared success status
      And a validation error with endpoint and request metadata is logged
      And output validation alone does not throw or suppress the response

    @unimplemented @unit
    Scenario: Output diagnostics never disclose response content
      Given invalid output contains a secret in a value and a dynamic record key
      And a custom schema error message repeats that secret
      When output validation logs the failure
      Then the log identifies the issue code and safe schema details
      And the secret is absent from every serialized log argument
      And the response body and raw validation error are not attached to the log

    @unimplemented @typecheck @architecture
    Scenario Outline: Ordinary handlers cannot construct special responses
      Given a governed endpoint with an inline handler
      When the handler attempts to return <result>
      Then the declaration fails type checking or architecture lint
      And guidance names the explicit framework integration for special protocols

      Examples:
        | result                  |
        | a text string           |
        | a raw Response          |
        | an SSE stream           |
        | a NO_CONTENT sentinel   |
        | an app.text() response  |

    @unimplemented @typecheck @unit
    Scenario: Void cannot discard a handler's actual return type
      Given an endpoint declares a void output schema
      When its handler returns an object directly or through a promise
      Then type checking rejects the handler
      And a handler returning nothing emits the declared empty response

    @unimplemented @architecture
    Scenario: The complete handler remains visible in its fluent declaration
      Given an endpoint declares its verb, path, permission and schemas
      When its handler is supplied as a detached function, factory or bound method
      Then architecture lint requests an inline inferred handler beside those declarations

    @unimplemented @typecheck @unit
    Scenario: Middleware facts are parsed trailing arguments
      Given two middleware declarations with distinct output schemas
      When both middleware results pass parsing
      Then the handler receives the two inferred values as trailing arguments in declaration order
      And its input contains only the parsed endpoint input
      And omitting a middleware removes its argument from the handler type

    @unimplemented @integration
    Scenario: Malformed middleware facts never reach a handler
      Given authentication middleware declares a tenant identity output schema
      When its result does not match that schema
      Then the handler is not invoked
      And no domain write occurs

    @unimplemented @typecheck @architecture @unit
    Scenario: Middleware cannot smuggle transport objects into domain input
      Given middleware reads a SCIM credential or verifies a webhook signature
      When it supplies facts to a governed handler
      Then only parsed semantic facts are supplied as trailing arguments
      And headers, credentials, request and response objects remain inaccessible
      And aliases and nested input properties do not bypass that boundary
      And the facts cannot replace the authorized principal or tenant target

    @unimplemented @integration
    Scenario: Special response protocols have explicit framework contracts
      Given an endpoint needs SSE, a download or a text protocol
      When the endpoint is installed
      Then its framework integration owns framing, content type, status and response lifecycle
      And ordinary JSON handlers retain no raw response capability

    @unimplemented @integration
    Scenario: Compatibility aliases preserve the complete guarded operation
      Given canonical and compatibility addresses for an annotation operation
      When the same allowed and denied requests use each address
      Then authorization, validation and error mapping agree
      And all addresses invoke the same installed service instance

    @unimplemented @integration
    Scenario: Denying a correction does not discard an otherwise permitted comment
      Given a user allowed to annotate a trace but denied the secondary correction permission
      When the user submits a comment with a suggested correction
      Then the comment is saved under that user's authorized project
      And the trace correction is not written

  Rule: migration checks must prove that plausible regressions fail

    @typecheck
    Scenario: Compiler-negative cases start from a valid declaration
      Given a fixture whose app, dependency graph and infrastructure compile successfully
      When one forbidden dependency, config or infrastructure change is introduced
      Then compilation fails at the changed boundary with the expected diagnostic
      And an unrelated error elsewhere cannot satisfy the assertion

    @unimplemented @integration
    Scenario: A review response keeps the full trace contract
      Given a trace with offloaded content, spans, metadata, costs and timestamps
      When an authorized reviewer reads it through an annotation queue
      Then the response preserves all fields and full content from the characterized response
      And restricted viewers receive the same redactions as other trace reads
      And substituting a summary or preview fails the parity check

    @unimplemented @unit
    Scenario: UI installation cannot select an identically named settings layout
      Given project and settings branches with the same layout component
      When all annotation addresses are matched by the native router
      Then every address selects its exact intended page
      And its layout is the same route instance as an existing project page
      And missing or duplicate project installation anchors fail before serving

    @unimplemented @architecture
    Scenario: Adoption cannot be declared complete by weakening its guards
      Given a migration that introduces raw handler access or a foreign service import
      When its lint fixture, baseline or suppression is changed to accept that code
      Then the migration review rejects the weakened guard
      And the guard is demonstrated to reject a representative forbidden change
      And unfinished callers remain visible instead of receiving an adoption exemption

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
      When a declaration calls defineFeature with annotations
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

  Rule: a feature publishes one app implementing its callable API

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

    @unit
    Scenario Outline: Feature services start before hosts and drain before API bindings close
      Given a feature registers an inert subscription with resources.ownService
      And the process registers a serving host
      When the runtime boots for the <role> role
      Then no subscription or host has started
      When the runtime starts
      Then the subscription starts before the host
      When the runtime stops
      Then the host drains before the subscription stops
      And feature APIs remain callable during the drain
      And API bindings close before construction resources close

      Examples:
        | role   |
        | api    |
        | worker |

    @unit
    Scenario: Unstarted services do not receive stop calls
      Given a feature owns a construction allocation and registers an inert service
      When boot fails or the runtime stops before start
      Then the construction allocation closes once
      And the service receives neither start nor stop

    @unit
    Scenario: Late service registration cannot escape lifecycle ownership
      Given a feature retains its setup resource ownership
      When installation has returned
      Then registering another service is rejected
      And allocations acquired during startup can still register cleanup

  Rule: the API bootstrap honours feature service lifecycle during the composition cutover

    @unit
    Scenario: Subscription readiness gates the API listener
      Given the API composition registered a subscription service without starting it
      When API startup waits for its subscription acknowledgement
      Then the listener has not started
      And a subscription startup failure stops attempted services and releases resources

    @unit
    Scenario: The API drains registered services before releasing their infrastructure
      Given the API started its registered feature services and listener
      When the process closes
      Then the listener closes before registered services drain
      And services drain before telemetry and infrastructure close
      And a drain failure does not skip infrastructure cleanup

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
