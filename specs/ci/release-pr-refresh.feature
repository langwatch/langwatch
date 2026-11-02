Feature: Release pull requests refresh on a timer
  Every refresh of a release pull request re-runs its CI. Refreshing on every
  merge to main started about 160 runs a day, so release-please refreshes them
  every 4 hours instead. Plan: dev/docs/plans/ci-redesign.md

  @unit
  Scenario: Release pull requests refresh every 4 hours and can be refreshed by hand
    Given the release-please workflow
    When its triggers are read
    Then it runs on a 4-hourly schedule and can be started by hand

  @unit
  Scenario: A merge to main does not refresh the release pull requests
    Given a merge to main that is not a release pull request
    When the release-please workflow starts
    Then release-please is skipped and takes no runner

  @unit
  Scenario: Merging a release pull request publishes the release at once
    Given a merge to main whose commit is a release pull request
    When the release-please workflow starts
    Then release-please runs and creates the release
