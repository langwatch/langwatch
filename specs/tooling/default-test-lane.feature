Feature: The default test lane finishes without live services
  `pnpm test` in a package and `nx run-many -t test` over the workspace must
  finish on a machine with no model keys, no Docker and no deployment. A
  scenario suite drives live services and may wait an hour; in the default
  lane it looks exactly like a hung run and holds a parallel slot while it waits.

  Rule: `default-test-lane` refuses a package whose `test` script's vitest lane
    collects a `*.scenario.test.*` file or waits more than two minutes per test

  @unit
  Scenario: A default test lane that collects a scenario suite is reported
    Given a package whose default vitest lane includes a scenario test file
    When the default-test-lane policy runs
    Then it reports that scenario file

  @unit
  Scenario: A default lane that excludes or never includes its scenarios passes
    Given the lane excludes scenario files, includes only unit files, or the script passes --exclude
    When the default-test-lane policy runs
    Then it reports nothing

  @unit
  Scenario: A default test lane with a timeout above two minutes is reported
    Given the lane the test script runs sets testTimeout above two minutes
    When the default-test-lane policy runs
    Then it reports the evaluated timeout
