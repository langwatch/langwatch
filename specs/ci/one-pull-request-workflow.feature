Feature: One workflow starts a pull request's product checks
  Every product check used to start on every pull request and spend two
  runners deciding there was nothing to do. pr.yml decides once which checks a
  change reaches and calls only those. Plan: dev/docs/plans/ci-redesign.md

  @unit
  Scenario: Each product check starts only when a change reaches its own paths
    Given a product check whose detect-changes step consults some paths
    When pr.yml builds its filter
    Then that check's key holds every one of those paths
    And a change to pr.yml or its filter starts every check

  @unit
  Scenario: pr.yml is the only way a pull request starts a product check
    Given the product checks pr.yml calls
    When their triggers are read
    Then each can be called and none starts on its own for a pull request or the merge queue
    And pr.yml calls each only when its key changed

  @unit
  Scenario: Called checks never cancel each other
    Given the product checks pr.yml calls
    When their concurrency groups are read
    Then none is named after the calling workflow

  @unit
  Scenario: The checks main requires keep reporting
    Given the checks main's ruleset and branch protection require
    When ci-complete runs
    Then it posts each of them from the call that used to report it
    And a skipped call counts as passed

  @unit
  Scenario: The merge queue runs every product check
    Given a merge queue run
    When pr.yml decides what to start
    Then it starts every product check
