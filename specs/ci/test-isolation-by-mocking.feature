Feature: Only the test files that mock modules pay for isolation
  As a developer waiting on the package suites
  I want a suite's modules loaded once per worker wherever that is safe
  So that a suite does not re-import its whole module graph for every file

  # A suite asked for `isolate: true` because some of its files call `vi.mock`,
  # and `vi.mock` does not reach a module another file already loaded into a
  # shared registry. Isolating the whole suite for that made every file pay:
  # in the trace explorer suite, 76% of a run was re-importing modules and
  # rebuilding jsdom per file, and the tests themselves were 14%.

  Background:
    Given a suite whose config asks for isolation through the shared vitest config

  @unit
  Scenario: Files that mock modules run isolated and the rest share modules
    Given some of the suite's test files call vi.mock or vi.doMock
    When the suite's config is resolved
    Then the mocking files run in an isolated project
    And every other file runs in a project that shares modules across files

  @unit
  Scenario: A file that imports a helper which mocks modules runs isolated
    Given a test file that mocks nothing itself
    And it imports, by relative path, a test harness that calls vi.mock
    When the suite's config is resolved
    Then the test file runs in the isolated project

  @unit
  Scenario: A file the suite names as leaking runs isolated without mocking
    Given a test file that imports a module which patches the DOM when it loads
    And the suite's config names that file as one to isolate
    When the suite's config is resolved
    Then the file runs in the isolated project

  @unit
  Scenario: Only the files the suite selects are considered
    Given a mocking file that the suite's include or exclude leaves out
    When the suite's config is resolved
    Then that file is in neither project

  @unit
  Scenario: A file name with glob characters is matched literally
    Given a mocking test file under a directory named "[id]"
    When the suite's config is resolved
    Then the isolated project selects exactly that file

  @unit
  Scenario: A suite where every file mocks, or none does, is left as it is
    Given every test file in the suite mocks, or none does
    When the suite's config is resolved
    Then the config is returned unchanged

  @unit
  Scenario: A suite that keeps isolation off is left as it is
    Given a suite that does not ask for isolation
    When the suite's config is resolved
    Then the config is returned unchanged

  @unit
  Scenario: The isolated project collects only the files that need isolation
    Given a suite that names its own include patterns
    And some of its files mock modules
    When the suite's config is resolved
    Then the isolated project selects only the mocking files
    And no file runs in both projects

  @unit
  Scenario: A suite that isolates every file is left whole
    Given a suite whose files leak state other than through mocks
    And its config asks for every file to be isolated
    When the suite's config is resolved
    Then every file runs isolated in a single project
