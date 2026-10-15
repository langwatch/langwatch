Feature: OpsScope status probe never throws FORBIDDEN
  As any authenticated user
  I need `api.ops.getScope` to be a status probe that returns data
  So the global menu can hide ops UI without spamming my console with permission errors on every page load.

  Background: tracking lw#3584. `useOpsPermission()` (called from
  MainMenu, SettingsLayout, every ops shell, ...) was wrapped around
  `api.ops.getScope`, which itself ran a permission middleware and threw
  FORBIDDEN for non-admin users. Result: every non-admin saw a tRPC error
  in the console on every page load, even though the UI is *probing* for
  access — "no" is the honest answer, not an error.

  Now `OpsScope` is a discriminated union — every authenticated user has
  a scope, even if that scope is `{ kind: "none" }`. The ops app answers
  the scope (`operatorScope`) and the probe endpoint returns it; every other
  ops procedure declares its platform-operator grant, and the door refuses
  a caller without it before the handler runs.

  @unit
  Scenario: The operator scope of a user outside the operator list is none, never a refusal
    Given a non-admin authenticated user
    When the ops app answers their operator scope
    Then it returns `{ kind: "none" }`

  @unit
  Scenario: The operator scope of a platform operator is platform
    Given an admin authenticated user
    When the ops app answers their operator scope
    Then it returns `{ kind: "platform" }`

  @unit
  Scenario: An ops write is refused at the door for a non-operator
    Given an ops mutation that declares `ops:manage`
    When a non-admin user calls the mutation
    Then the door refuses it as FORBIDDEN, naming `ops:manage`
    And the handler is NOT invoked

  @unit
  Scenario: An operator's gated ops read is admitted
    Given an ops query that declares `ops:view`
    When an admin user calls the query
    Then the query answers
    And the scope probe answers `{ kind: "platform" }`

  @unit
  Scenario: The scope probe answers a non-operator with kind none
    Given the `ops.getScope` status probe
    When a non-admin user calls it
    Then it answers `{ scope: { kind: "none" } }`
    And nothing is refused
