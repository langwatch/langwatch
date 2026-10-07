# See ../../../.claude/handoffs/peer-b2-s2.md section 11 (replay step design)

Feature: Open suite runs are caught up with scenario's runs after the cut

  Suite runs still open when suite started following scenario's run facts may
  have missed facts recorded during the deploy. A background step compares each
  open suite run with scenario's runs of its batch and re-sends the starts and
  finishes it is behind on. It decides from the data as it is now.

  @unit
  Scenario: An open suite run behind scenario's runs counts each item once
    Given an open suite run that counted none of its batch's runs
    And scenario holds one finished run and one in progress
    When the replay step runs
    Then suite counts both items started and the finished one completed with its verdict

  @unit
  Scenario: A second replay changes nothing
    Given the replay step has caught an open suite run up
    When the replay step runs again
    Then suite sends nothing and the suite run is unchanged

  @unit
  Scenario: A suite run already level with scenario is left alone
    Given an open suite run that counts every item scenario holds
    When the replay step runs
    Then suite sends nothing

  @unit
  Scenario: A grade that moved after suite counted it is reported, not regraded
    Given an open suite run that counted a verdict scenario no longer holds
    When the replay step runs
    Then the step reports the run's grade drift and sends no regrade

  @unit
  Scenario: A finished suite run is not replayed
    Given a suite run that has finished
    When the replay step runs
    Then suite sends nothing for it

  @unit
  Scenario: A dry run reports and writes nothing
    Given an open suite run behind scenario's runs
    When the replay step dry-runs
    Then it reports what it would send, sends nothing and saves no checkpoint

  @unit
  Scenario: A resumed replay skips the tenants already done
    Given a checkpoint naming a tenant already replayed
    When the replay step resumes from it
    Then that tenant's suite runs are not read again

  @unit
  Scenario: The worker collects suite's replay step as a background step
    Given suite installed in a worker process
    When the worker collects its modules' migration steps
    Then it holds suite's replay step, background and run after old writers are gone
    And a second pass over it changes nothing
