Feature: OpsScope status probe never throws FORBIDDEN
  As any authenticated user
  I need `api.ops.getScope` to be a status probe that returns data
  So the global menu can hide ops UI without spamming my console with permission errors on every page load.

  Background: tracking lw#3584. `useOpsPermission()` (called from
  MainMenu, SettingsLayout, every ops shell, ...) was wrapped around
  `api.ops.getScope`, which itself ran `checkOpsPermission` middleware
  and threw FORBIDDEN for non-admin users. Result: every non-admin saw a
  tRPC error in the console on every page load, even though the UI is
  *probing* for access — "no" is the honest answer, not an error.

  Now `OpsScope` is a discriminated union — every authenticated user has
  a scope, even if that scope is `{ kind: "none" }`. The probe endpoint
  returns the scope; the middleware-guarded mutating endpoints still
  throw FORBIDDEN on `kind: "none"`.

  @unit
  Scenario: resolveOpsScope returns kind=none for non-ops users instead of null
    Given a non-admin authenticated user
    When resolveOpsScope is called
    Then it returns `{ kind: "none" }`

  @unit
  Scenario: resolveOpsScope returns kind=platform for admin users
    Given an admin authenticated user
    When resolveOpsScope is called
    Then it returns `{ kind: "platform" }`

  @unit
  Scenario: checkOpsPermission still throws FORBIDDEN for non-ops callers
    Given the checkOpsPermission middleware wrapping a mutation
    When a non-admin user calls the mutation
    Then the middleware throws TRPCError code=FORBIDDEN
    And `next` is NOT invoked

  @unit
  Scenario: checkOpsPermission grants access for admin callers
    Given the checkOpsPermission middleware wrapping a query
    When an admin user calls the query
    Then `next` is invoked
    And `ctx.opsScope.kind` is "platform"

  @unit
  Scenario: checkOpsPermission with throwOnDeny=false populates kind=none for status probes
    Given the checkOpsPermission middleware constructed with `{ throwOnDeny: false }`
    When a non-admin user calls the wrapped procedure
    Then `next` is invoked
    And `ctx.opsScope.kind` is "none"
