Feature: Typed permission declarations
  As a LangWatch engineer
  I need every permission check to be a declaration typed against the input
  it reads its scope from
  So that a miswired check is a compile error at the call site instead of a
  runtime failure in production

  # Spec for ADR-092 delivery-plan PR 4, decision 25 (the declared surface).
  # The registry (packages/authz/src/registry.ts) already states, per
  # resource, the scope tiers it can be granted at; this feature makes the
  # declaration surfaces derive their typing from that single source. The
  # scenarios about compile errors are bound by type-assertion tests that
  # `pnpm typecheck:tests` enforces; the vitest run proves the runtime half.
  #
  # Vocabulary (delivery-plan decision 3): permission = the what,
  # scope = the where. Scope ids in procedure inputs are `projectId`,
  # `teamId`, `organizationId`; platform-tier permissions have no id.

  Background:
    Given the permission registry declares, per resource, the scope tiers it can be granted at

  # ============================================================================
  # The tRPC builder: .permission()
  # ============================================================================

  @unit
  Scenario: A declared permission reads its scope from the validated input
    Given a procedure whose input carries a required "projectId"
    When the procedure declares permission "traces:view"
    Then the check runs at that project's scope for the authenticated user
    And the declaration compiles

  @unit
  Scenario: Declaring a permission with no usable scope id in the input fails to compile
    Given a procedure whose input carries no projectId, teamId, or organizationId
    When the procedure declares permission "traces:view"
    Then the declaration is a compile error naming the missing scope id

  @unit
  Scenario: An input id from a tier the permission cannot be granted at fails to compile
    Given a procedure whose input carries a required "projectId"
    When the procedure declares the organization-only permission "governance:view"
    Then the declaration is a compile error
    And the error names the offending field and the tiers the permission allows

  @unit
  Scenario: The most specific tier the permission allows decides the check scope
    Given a procedure whose input carries both "projectId" and "organizationId"
    When the procedure declares permission "traces:view"
    Then the check runs at the project scope

  @unit
  Scenario: A scope derivation is written at the call site, never inferred
    Given a procedure whose input carries only "teamId"
    When the procedure declares the organization-only permission "organization:manage" via "teamId"
    Then the check resolves the team's organization and runs there
    And declaring the same permission without the derivation is a compile error

  @unit
  Scenario: A platform-tier permission is refused by the scoped declaration surface
    Given platform-tier checks resolve an operator scope no procedure input carries
    When a procedure declares permission "ops:view"
    Then the declaration is a compile error pointing at the operator middleware

  @unit
  Scenario: Any one of several declared permissions is enough
    Given a procedure whose input carries a required "projectId"
    When the procedure declares that any of "traces:view" or "scenarios:view" suffices
    Then a caller holding only "scenarios:view" on the project is permitted
    And a caller holding neither is denied

  @unit
  Scenario: An input modelled as a union is checked per member
    Given a procedure whose input is either "projectId" or "organizationId"
    When the procedure declares permission "project:update"
    Then a call naming a project checks at the project scope
    And a call naming an organization checks at the organization scope

  # ============================================================================
  # Declared opt-outs
  # ============================================================================

  @unit
  Scenario: Opting out of permission checks requires a written reason
    Given a procedure that reads no organization, team, or project data
    When it declares no permission with a reason
    Then the procedure runs for any authenticated user
    And the reason is readable from the declaration

  @unit
  Scenario: An opted-out procedure cannot silently read scoped input
    Given a procedure declared with no permission
    When its input carries a "projectId" without an allowance naming why
    Then the declaration is a compile error

  @unit
  Scenario: A service-authorized procedure declares the permissions its service enforces
    Given a procedure whose scope is resolved from data loaded at runtime
    When it defers authorization to its service with a written reason
    Then the declaration names the permissions the service enforces
    And the sweep counts the procedure as declared rather than unguarded

  # ============================================================================
  # One seam, decision-neutral (decision 25)
  # ============================================================================

  @unit
  Scenario: A declared check decides exactly as the middleware it replaced
    Given an organization not yet cut over to the engine
    When a declared permission check runs for one of its members
    Then the legacy resolver decides and the engine shadows it
    And for a cut-over organization the engine decides and legacy reverse-shadows

  @unit
  Scenario: A denial carries a stable code the client can present
    Given a caller without "traces:view" on project "chatbot"
    When a procedure declaring "traces:view" runs for them
    Then the request is refused with code "permission_denied"
    And the refusal names the permission and the scope tier it was refused at

  @unit
  Scenario: A lite member's denial is distinguishable from a missing grant
    Given a lite member of an organization
    When a declared check denies them a restricted feature
    Then the refusal carries the lite-member restriction
    So the client can explain the account limitation instead of a missing role

  @unit
  Scenario: A scope id that resolves to nothing is denied like one the caller may not touch
    Given a procedure declaring "traces:view"
    When it is called with a projectId that does not exist
    Then the request is refused with code "permission_denied"
    And the refusal does not reveal whether the project exists

  # ============================================================================
  # The HTTP surface speaks the same vocabulary
  # ============================================================================

  @unit
  Scenario: A route policy cannot name a permission outside the registry
    Given the HTTP route policy surface
    When a route declares a permission that no resource supports
    Then the declaration is a compile error

  # Deliberately NOT a compile error: a project credential's scope chain
  # ascends to its organization, so an organization-tier permission on a
  # project app (the governance ingestion surface's aiTools) is answerable —
  # only organization-scoped bindings can grant it, and the walk consults
  # them. The registry vocabulary rule above is the enforced half.

  # ============================================================================
  # The imperative facade
  # ============================================================================

  @unit
  Scenario: An imperative check names its scope id to match the permission
    Given a service checking a permission outside a route middleware
    When it asks the facade for "traces:view" with a projectId
    Then the check compiles and decides through the same seam
    And asking for an organization-only permission with a projectId is a compile error

  # ============================================================================
  # Every check resolves the one App-composed service
  # ============================================================================

  @unit
  Scenario: Every grant check decides through the App the request context carries
    Given the permissions service composed once on the App
    When a declared tRPC check, a REST credential middleware, or the imperative facade decides
    Then each resolves the service from its request context or the App
    And none composes its own service from a database client

  @unit
  Scenario: An endpoint's middleware array cannot displace its declared check
    Given a management endpoint that declares a permission and carries its own middleware
    When a request reaches the endpoint
    Then the framework mounts the declared permission check itself
    And the check runs even though the endpoint replaced the guard's middleware array

  @unit
  Scenario: A registered policy that promises an unenforced permission fails the build
    Given a management endpoint whose declared policy names a permission the config does not enforce
    When the service builds
    Then the build fails naming both halves of the declaration

  @unit
  Scenario: A passing imperative check returns a proof, not a boolean
    Given a caller the engine permits
    When an asserting imperative check runs
    Then it returns a witness naming the permission and the decided scope
    And a function can demand the witness in place of a raw id

  @unit
  Scenario: An imperative denial throws before the caller can continue
    Given a caller the engine refuses
    When an asserting imperative check runs
    Then it throws the engine's denial with its stable code
    And an unauthenticated context is refused before any id is read

  @unit
  Scenario: A hand-rolled procedure middleware cannot claim a permission check
    Given the pending procedure builder's custom-check escape hatch
    When a middleware without a declaration is passed to it
    Then the registration does not compile
    And only middleware built by the declaration helper is accepted

  @unit
  Scenario: A service endpoint that declares no access fails to compile
    Given a service endpoint configuration
    When it names neither a permission nor a written opt-out
    Then the registration does not compile
    And naming both does not compile either

  @unit
  Scenario: A service endpoint without an access declaration refuses to boot
    Given an endpoint that bypassed the types and declares no access
    When the service builds
    Then the build fails naming the endpoint

  @unit
  Scenario: A service endpoint opting out of its permission check carries a written reason
    Given an endpoint opting out with a blank reason
    When the service builds
    Then the build fails

  # ============================================================================
  # The CI sweep: what the types cannot reach
  # ============================================================================

  @unit
  Scenario: Every scope id a procedure accepts is checked or explicitly allowed
    Given a procedure whose input requires a project, team or organization id
    When the declaration sweep walks the router
    Then the sweep refuses any id no declared check resolves a scope from,
      except a named, shrink-only list of known gaps
    And an id a custom middleware enforces must be named by that declaration
    And a gap on that list that has been closed also fails the sweep, so a
      fix cannot leave its entry behind

  @unit
  Scenario: An optional narrower scope id cannot shadow a required wider tier
    Given a procedure that requires an organization id and also accepts an
      optional project id
    And a check declared at the organization tier
    When the sweep resolves the tier the runtime would pick from the full input
    Then it sees the optional project id shadow the organization tier
    And it reports the required organization id as unchecked

  @unit
  Scenario: A nullable scope id is required, not skipped
    Given a procedure whose scope id is nullable rather than optional
    When the sweep decides which ids must be checked
    Then the nullable id counts as one that reaches the handler
    And it must be covered like any other required id

  @unit
  Scenario: A declaration that cannot resolve a scope from its input fails the sweep
    Given a procedure declaring a permission
    When its input carries no id at a tier the permission is grantable at
    Then the sweep refuses the procedure

  # The sweep closes tier-shadowing statically, but only for declarations it
  # can see through; a custom middleware's enforcement is a black box, and a
  # future bug could still check one id while the handler acts on another.
  # This runtime guard makes the exploit's precondition unreachable: a request
  # cannot carry scope ids from two tenants at all, so passing a check on your
  # own narrow id can never aim a query at someone else's wider one.
  @unit
  Scenario: Scope ids from two organizations in one request are refused
    Given a request whose input carries scope ids resolving to two different organizations
    When any procedure receives it, whatever its declaration kind
    Then the request is refused before the permission check runs
    And the refusal is indistinguishable from a permission denial
    And the mismatch is logged with both organizations for the operator

  @unit
  Scenario: A scope id resolving to no organization cannot anchor a mixed request
    Given a request carrying more than one scope id
    And one of them resolves to no organization at all
    When any procedure receives it
    Then the request is refused before the permission check runs

  @unit
  Scenario: A request whose scope ids agree passes the lineage guard untouched
    Given a request whose scope ids all resolve to one organization
    When the procedure receives it
    Then the guard adds no refusal and the declared check decides as before
    And a request carrying at most one scope id is not resolved at all

  @unit
  Scenario: A procedure whose input cannot be inspected fails the sweep
    Given a procedure whose input schema the sweep cannot read
    When the sweep walks the router
    Then the procedure is reported rather than skipped
