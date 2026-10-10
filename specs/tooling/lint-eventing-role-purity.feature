Feature: The eventing-role-purity lint rule
  The worker refolds projections and replays process managers from the ordered
  event stream, so their evolution is synchronous and deterministic: no awaits,
  no async declarations, no timers or fetches, no I/O imports, no dynamic
  imports. No role appends durable events itself; a command handler does. And
  because delivery is at-least-once, every module subscriber proves its
  idempotency with a redelivery test beside it. The file name gives the role:
  `*.projection.ts`, `*.subscriber.ts`, `processes/*.process.ts`.

  @unit
  Scenario: A projection with several impurities is reported once, at the first
    Given a projection fold that calls fetch and then sets a timer
    When the eventing-role-purity rule runs over it
    Then it reports projectionImpure once, on the fetch line

  @unit
  Scenario: A process manager that declares async work is reported at the method
    Given a process manager class with an async method
    When the eventing-role-purity rule runs over it
    Then it reports processImpure on the method's line

  @unit
  Scenario: No eventing role appends durable events directly
    Given a process manager that calls appendEvents
    When the eventing-role-purity rule runs over it
    Then it reports durableEvent naming the call

  @unit
  Scenario: A subscriber without a named redelivery test is reported
    Given a module subscriber with no `__tests__/<name>.redelivery.test.ts` beside it
    When the eventing-role-purity rule runs over it
    Then it reports missingRedeliveryTest with the path to add

  @unit
  Scenario: A subscriber may await work once its redelivery test exists
    Given a module subscriber that awaits a fetch and has its redelivery test
    When the eventing-role-purity rule runs over it
    Then it reports nothing
