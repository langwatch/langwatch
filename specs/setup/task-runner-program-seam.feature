Feature: The task runner compiles the modules it composes, not whole feature packages

  `apps/tasks` runs one scheduled job at a time. It composes a handful of
  adapters, ports, services and tasks out of the feature server packages, and
  it should pay for those modules and nothing else.

  A feature server package's barrel exports its whole surface, so importing one
  adapter through it loaded the package entire — and, through the packages the
  rest of that surface depends on, a speech SDK, an observable library and
  three AWS clients that no task in the runner ever calls. Naming the module
  instead of the barrel is what keeps the runner's typecheck the size of the
  work it actually does.

  Server packages expose those modules as `./composition/<name>` subpaths, the
  same shape `@langwatch/trace-server` already used for its trace-edit-overlay
  repository.

  ADR: dev/docs/adr/130-the-api-router-type-is-declared.md

  @unit
  Scenario: A composition imports the module it needs, not its feature's barrel
    Given the task runner composes an adapter out of a feature server package
    When the modules the compiler loads for the runner are walked, following
      type-only imports as well as value ones
    Then the feature server package's barrel is not among them
    And a composition that reaches for the barrel again fails with the packages
      it pulled back in

  @unit
  Scenario: The task runner's module graph stays under its ceiling
    Given the task runner's every source file
    When the workspace source modules the compiler loads for them are counted
    Then the count stays under the recorded ceiling
    And a change that widens the graph fails with the new count, not silently
