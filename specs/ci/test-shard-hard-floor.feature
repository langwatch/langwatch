Feature: Test shard hard-floor failures
  As a maintainer
  I want a wedged test shard to fail visibly
  So that unfinished or failing tests cannot be reported as successful

  @regression @unit
  Scenario: A unit test shard hard floor exits with failure after four minutes
    Given a CI unit test shard has a four-minute hard-floor timeout
    When four minutes expire before Vitest finishes
    Then the test process exits with a non-zero status

  @regression @unit
  Scenario: An integration test shard hard floor exits with failure after twenty minutes
    Given a CI integration test shard has a twenty-minute hard-floor timeout
    When twenty minutes expire before Vitest finishes
    Then the test process exits with a non-zero status
