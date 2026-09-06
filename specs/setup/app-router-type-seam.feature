Feature: Naming the API router type does not compile the API application

  `AppRouter` is the type of the router the API process mounts. A browser
  package names it to get typed procedures, and it should pay for the wire
  contract — the procedure names, their inputs and their outputs — and nothing
  else.

  It has never worked that way. `AppRouter` is inferred from the value the
  application builds, so naming the type opens the application's whole module
  graph: every feature composition, every transport mount, every feature server
  package, and through those the AWS, Stripe, kysely and speech SDKs those
  packages depend on. One `import type` in the browser application reproduced
  the API process's entire typecheck inside it.

  `import type` does not protect against this. The compiler still loads the
  named module and still follows that module's own value imports, so a chain
  of forty type-only imports drags forty value graphs behind it.

  ADR: dev/docs/adr/130-the-api-router-type-is-declared.md

  @unit
  Scenario: A feature's composed record is reached without its composition
    Given a feature composes an application, a router and its adapters
    When a program names only the record that feature contributes to the router
    Then it reaches the record and the router the record names
    But it does not reach the repositories, adapters or byte stores the
      composition opens

  @unit
  Scenario: The router type's module graph stays under its ceiling
    Given a program whose whole content is a type-only import of `AppRouter`
    When the modules that program loads are counted
    Then the count stays under the recorded ceiling
    And a change that widens the graph fails with the new count, not silently
