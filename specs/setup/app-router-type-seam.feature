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

  Each module's browser package now derives its typed procedures from its own
  contract (`ContractApiMap<typeof fooTrpc>` passed to `createModuleApi`); no
  aggregated router type remains. The ratchet moved with it: the graph behind
  those per-module maps is what stays small.

  @unit
  Scenario: A module's procedure map is reached without its process half
    Given every module declares its typed procedures from its contract
    When a program names those procedure maps
    Then it reaches the contracts and the schemas they name
    But it does not reach any module's process package or any application

  @unit
  Scenario: The module procedure maps' graph stays under its ceiling
    Given a program that names every module's procedure map
    When the modules that program loads are counted
    Then the count stays under the recorded ceiling
    And a change that widens the graph fails with the new count, not silently

  @unit
  Scenario: The browser program compiles no API application source
    Given the browser application's every source file
    When the modules the compiler loads for them are walked, following
      type-only imports as well as value ones
    Then not one of them belongs to the API application
    And a browser package that names the router type again fails with the
      files it pulled back in
