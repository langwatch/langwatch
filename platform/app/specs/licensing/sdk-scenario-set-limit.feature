Feature: SDK Scenario Set Limit on Free Plan

  Free-plan users can create up to 3 distinct scenario sets via the SDK.
  Scenarios within an existing set are unlimited, and existing sets can be
  re-run without restriction. Only new, externally-created sets count
  against the limit.

  Background:
    Given an organization on the free plan
    And the organization has a project with a valid API key

  # ---------------------------------------------------------------------------
  # Allowing scenario sets within the limit
  # ---------------------------------------------------------------------------

  @unit
  Scenario: First scenario set is accepted
    Given the organization has no existing scenario sets
    When the SDK sends a run-started event with a new scenario set ID
    Then the request succeeds with 201
    And the scenario run is recorded

  @unit
  Scenario: Second and third scenario sets are accepted
    Given the organization has 2 existing scenario sets
    When the SDK sends a run-started event with a new scenario set ID
    Then the request succeeds with 201

  @unit
  Scenario: Multiple scenarios within one set are unlimited
    Given the organization has 3 existing scenario sets
    When the SDK sends a run-started event for an existing scenario set with a new scenario ID
    Then the request succeeds with 201

  @unit
  Scenario: Re-running an existing set is always allowed
    Given the organization has 3 existing scenario sets
    When the SDK sends a run-started event for an existing scenario set
    Then the request succeeds with 201

  # ---------------------------------------------------------------------------
  # Blocking new sets beyond the limit
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Fourth scenario set is blocked
    Given the organization has 3 existing scenario sets
    When the SDK sends a run-started event with a new scenario set ID
    Then the request is rejected with 403
    And the response includes an upgrade message

  @unit
  Scenario: Fifth scenario set is also blocked
    Given the organization has 4 existing scenario sets from before enforcement
    When the SDK sends a run-started event with a new scenario set ID
    Then the request is rejected with 403

  # ---------------------------------------------------------------------------
  # Internal platform sets are excluded from the count
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Internal platform sets do not count toward the limit
    Given the organization has 3 internal platform scenario sets
    And the organization has no external scenario sets
    When the SDK sends a run-started event with a new scenario set ID
    Then the request succeeds with 201

  @unit
  Scenario: Only external sets count toward the limit
    Given the organization has 2 external scenario sets
    And the organization has 5 internal platform scenario sets
    When the SDK sends a run-started event with a new scenario set ID
    Then the request succeeds with 201

  # ---------------------------------------------------------------------------
  # Non-run-started events are not checked
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Message snapshot events pass through without limit check
    Given the organization has 3 existing scenario sets
    When the SDK sends a message-snapshot event with a new scenario set ID
    Then the request succeeds with 201

  @unit
  Scenario: Run-finished events pass through without limit check
    Given the organization has 3 existing scenario sets
    When the SDK sends a run-finished event with a new scenario set ID
    Then the request succeeds with 201

  # ---------------------------------------------------------------------------
  # Paid plans are not limited
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Paid plan allows unlimited scenario sets
    Given an organization on a paid plan
    And the organization has 10 existing scenario sets
    When the SDK sends a run-started event with a new scenario set ID
    Then the request succeeds with 201

  # ---------------------------------------------------------------------------
  # Cache behavior: known sets skip the database query
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Known scenario set ID is allowed without querying the database
    Given the organization has a recently verified scenario set "my-set"
    When the SDK sends a run-started event for scenario set "my-set"
    Then the request succeeds with 201
    And no database query is made to count scenario sets

  @unit
  Scenario: Unknown scenario set ID triggers a database count
    Given the organization has no cached scenario set information
    When the SDK sends a run-started event with a new scenario set ID
    Then a database query counts the distinct external scenario sets
    And the result is cached for subsequent requests
