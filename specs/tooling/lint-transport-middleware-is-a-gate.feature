Feature: The transport-middleware-is-a-gate lint rule
  A middleware fact carries credentials, audit, rate limits and body format -
  resolved once at the boot seam before a handler runs. A capability is a
  method on the app. A defineRestMiddleware fact whose name reads like a
  capability (effect, capability, client, builder, report), or whose declared
  schema carries a function-typed field, is a capability smuggled in as a
  fact.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A middleware fact named after a capability is not a gate
    Given a module transport file with a middleware fact named agentRestEffects
    When the transport-middleware-is-a-gate rule runs over it
    Then it reports reservedName
    And the message names the middleware fact

  @unit
  Scenario: A function-typed middleware field is a capability in disguise
    Given a module transport file with a middleware fact whose schema has a function-typed field
    When the transport-middleware-is-a-gate rule runs over it
    Then it reports functionMember
    And the message names the function-typed field

  @unit
  Scenario: A credential-only middleware fact is a gate
    Given a module transport file with a middleware fact carrying only a credential field
    When the transport-middleware-is-a-gate rule runs over it
    Then it reports nothing

  @unit
  Scenario: A middleware-shaped call outside transport is not governed
    Given a module service file with the same middleware-shaped call
    When the transport-middleware-is-a-gate rule runs over it
    Then it reports nothing
