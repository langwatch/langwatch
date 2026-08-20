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
