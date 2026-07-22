Feature: haven automatic preparation
  up owns the whole path from a fresh machine to a running stack: bootstrap,
  dependency install, database create-and-recover, and image reuse are
  idempotent preflight steps — never separate commands, never errors the
  developer must know how to fix by hand. See ADR-064.

  Scenario: First up on a fresh machine needs no setup command
    Given a machine where portless has never been installed
    When the developer runs "haven up"
    Then portless is installed, its CA trusted, and the proxy started as part of up
    And there is no separate setup command to know about

  Scenario: Stale dependencies install themselves
    Given the lockfile changed since the last install
    When the developer runs "haven up"
    Then dependencies are installed before any service starts

  Scenario: A missing database is created, migrated, and seeded
    Given this worktree has no databases yet
    When the developer runs "haven up"
    Then its databases exist, are migrated, and are seeded before the app starts

  Scenario: A stopped database server is started, not reported
    Given the shared ClickHouse container is stopped
    When the developer runs "haven up"
    Then the container is started and up proceeds

  Scenario: A wedged database container is recovered without data loss
    Given the shared ClickHouse container is unhealthy and not responding
    When the developer runs "haven up"
    Then the container is recreated with its data volume preserved
    And up proceeds once it is healthy

  Scenario: A broken database is never silently dropped
    Given migrations fail against this worktree's existing database
    When the developer runs "haven up"
    Then up stops with the migration error
    And the message names the one recovery command: "haven db reset"
    And no data was dropped

  Scenario: The langy image is reused when its inputs are unchanged
    Given langy is selected and its image was built from the current build inputs
    When the developer runs "haven up"
    Then the existing image is used and nothing is rebuilt

  Scenario: The langy image rebuilds only when its inputs change
    Given the langy Dockerfile or a file it copies has changed
    When the developer runs "haven up"
    Then the image is rebuilt once
    And subsequent ups reuse it until the inputs change again

  Scenario: A published prebuilt image is pulled instead of built
    Given no local image matches the current build inputs
    And CI has published an image for exactly those inputs
    When the developer runs "haven up"
    Then the image is pulled rather than built

  Scenario: Rebuilding on demand is one flag
    Given langy is running
    When the developer runs "haven restart langy --rebuild"
    Then the image is rebuilt regardless of input hashing and langy restarts on it
