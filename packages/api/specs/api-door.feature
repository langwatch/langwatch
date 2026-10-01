# The one API door (packages/api/src/hosting/api-door.ts): auth binds it from its own peers, the
# process opens it before its hosts. Record §4 and §8.
Feature: One module binds the door every API request passes
  An api process verifies who is calling (the browser session, an API key) and what they may do
  (authorization, plan gates, the audit trail) through one door. auth binds it from the peers it
  already holds, so the process framework names no module. A process that cannot verify a caller
  must not serve, rather than answer every request as an anonymous one.

  Rule: Exactly one installed module binds the API door

    @unit
    Scenario: An api process with no module binding the door refuses to boot
      Given an api process whose installed modules bind no API door
      When the process opens its hosts
      Then boot is refused with MissingApiDoorError, which names "auth"
      And no host is built over an unverified session reader

    @unit
    Scenario: Two modules binding the door refuse boot by name
      Given two installed modules each bind an API door
      When the process opens its hosts
      Then boot is refused with DuplicateApiDoorError, naming both modules

    @unit
    Scenario: The bound door is the one every host answers through
      Given auth binds the API door among its transport facts
      When the process opens its hosts
      Then the process opens exactly the door auth bound
      And the door binding is mounted on no REST family or tRPC namespace as a fact
