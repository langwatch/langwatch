# The per-image code step list (migration plan 2026-10-08, F-1; coordinator ruling R1, 2026-10-08).
# The api builds no migration steps, so the image ships the tasks process's collection as a
# generated file the api and worker gates read; CI fails when the file is stale.

Feature: The image ships the code steps its tasks process collects
  As an operator of a LangWatch installation
  I want every serving process to know the image's code steps without building them
  So that steps waiting on old writers are declared and run, and blocking ones are required

  @unit
  Scenario: A stale code step list fails the check, naming each step that differs and the fix
    Given a committed code step list and a fresh collection that adds one step and changes another's mode
    When the list is checked against the collection
    Then the check names the added step and the changed step
    And it names the command that rewrites the list

  @unit
  Scenario: A fresh code step list passes the check
    Given a committed code step list equal to the fresh collection
    When the list is checked against the collection
    Then the check names nothing

  @unit
  Scenario: A code step list that is not a list of steps is refused by name
    Given a code step list file holding a step with no mode
    When the gate reads it
    Then the read refuses, naming the file
