Feature: The default test lane finishes without live services
  `pnpm test` in a package and `nx run-many -t test` over the workspace run the `test`
  script and must finish on a machine with no model keys, no Docker and no deployment. A
  scenario suite drives live services and may wait an hour; in the `test` lane
  it looks exactly like a hung run and holds a parallel slot while it waits.

  Rule: `default-test-lane` refuses a package whose vitest lane (`test`, and `test:unit` if declared)
    collects a `*.scenario.test.*` file or waits more than two minutes per test.
    It also refuses one whose lane the package suites job runs (`test:unit` if declared, else `test`)
    collects a file that starts a container (specs/ci/package-suite-integration-lane.feature).
    A script that only runs `pnpm test` or `pnpm test:unit` is read as that script. A lane that
    is not vitest is skipped, with no fallback to `test`.

  @unit
  Scenario: A default test lane that collects a scenario suite is reported
    Given a package whose `test` vitest lane includes a scenario test file
    When the default-test-lane policy runs
    Then it reports that scenario file

  @unit
  Scenario: A default lane that excludes or never includes its scenarios passes
    Given the lane excludes scenario files, includes only unit files, or the script passes --exclude
    When the default-test-lane policy runs
    Then it reports nothing

  @unit
  Scenario: A default test lane with a timeout above two minutes is reported
    Given the lane the `test` script runs sets testTimeout above two minutes
    When the default-test-lane policy runs
    Then it reports the evaluated timeout

  # Lanes are keyed on the script name, so a suite that starts containers from the suites-job lane
  # still lands beside a browser suite, as @langwatch/log-process's private-dataplane suite
  # did. The default-test-lane policy follows the calls of each file that lane collects to a
  # testcontainers class or startTestClickHouseEndpoints, through local helpers, for every
  # package the job runs (not those in .github/package-suites.excluded).
  @unit @regression
  Scenario: A shared test lane that starts a container is reported
    Given a package the package suites job runs, whose `test:unit` lane (else `test`) collects a file
    And that file starts a container directly or through a helper module
    When the default-test-lane policy runs
    Then it reports that file and points it to a `test:integration` lane

  @unit
  Scenario: A shared test lane that leaves its container suites to test:integration passes
    Given a package whose suites-job lane excludes its container suites, or only imports a value from a module that starts containers
    And a package that starts containers from its suites-job lane but that the package suites job leaves to a job of its own
    When the default-test-lane policy runs
    Then it reports nothing

  @unit @regression
  Scenario: A split test and test:unit are each checked for what they run
    Given a package whose `test` lane collects a scenario suite while `test:unit` is clean
    And a package whose `test:unit` lane collects a file that starts a container while `test` is clean
    And a package whose `test:unit` is empty and whose `test` lane collects such a file
    When the default-test-lane policy runs
    Then it reports the scenario file, and the container files naming the lane read

  @unit
  Scenario: A test:unit lane that collects a scenario suite is reported
    Given a package whose vitest `test:unit` lane collects a scenario suite or sets a timeout above two minutes
    And its `test` lane is clean
    When the default-test-lane policy runs
    Then it reports the file or timeout naming `test:unit`, once when `test` runs the same lane

  @unit
  Scenario: A script that only hands off to another is read as that script
    Given a package whose `test` script runs `pnpm run test:unit`, a vitest lane that collects a scenario suite
    And a package whose `test:unit` script runs `pnpm test`, a vitest lane that collects a file that starts a container
    When the default-test-lane policy runs
    Then it reports the scenario file naming `test:unit`, and the container file naming `test`

  @unit
  Scenario: A CI lane that is not vitest is not checked for containers
    Given a package whose `test:unit` runs `node --test` and whose vitest `test` collects a file that starts a container
    When the default-test-lane policy runs
    Then it reports nothing
