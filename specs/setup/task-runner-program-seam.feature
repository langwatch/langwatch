Feature: The task runner compiles the installed modules and little else

  `apps/tasks` boots the installed module list in the producer-only tasks role
  and runs one task at a time (record section 4). Every module's process
  package is therefore in its program by design; what it should not grow is
  the graph it adds on top of that list: its own migrations, the process
  framework and its tests.

  ADR: dev/docs/adr/130-the-api-router-type-is-declared.md

  @unit
  Scenario: The task runner's module graph stays under its ceiling
    Given the task runner's every source file
    When the workspace source modules the compiler loads for them, beyond the
      installed module list, are counted
    Then the count stays under the recorded ceiling
    And a change that widens the graph fails with the new count, not silently
