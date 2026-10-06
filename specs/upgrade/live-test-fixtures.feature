# A live test boots a real api or worker over the local test stores (LANGWATCH_TEST_*). The
# serving processes no longer migrate (entry-points.feature), so the live fixtures run the
# upgrade themselves, the way every entry point does, before anything serves. The upgrade runs
# in apps/tasks with only the test stores' URLs: never `.env`, never `--env-file`.

Feature: Live test fixtures run the upgrade before they boot
  As a developer running the live api and worker suites locally
  I want the fixture to bring the test database up to this image before it boots
  So that a live suite never meets a server refused for an upgrade nobody ran

  @unit
  Scenario: A live test boots against a test database whose upgrade has not run
    Given a test process whose live fixture has not yet upgraded the test database
    When two live boots ask for the upgraded test database
    Then the upgrade runs once, in the tasks app, with only the test stores' URLs and NODE_ENV=test
    And it names no env file
    And both boots go on once it has succeeded

  @unit
  Scenario: The live fixture fails the test by name when the upgrade fails
    Given a test process whose live fixture upgrade exits non-zero
    When a live boot asks for the upgraded test database
    Then the boot fails with the code live_upgrade_failed, the exit code and the upgrade's output
    And no server is booted
    And a later boot in the same process fails the same way without running it again
