Feature: A listed run's record holds only its outstanding groups
  As the queue an upgrade's background steps and migration passes send their work through
  I want a listed run to forget each group once it holds nothing the run still waits on
  So that a pass over hundreds of thousands of groups keeps Redis bounded, not one entry per
  group it ever sent (Alex, 2026-10-12: a 2,007-organisation pass grew one run to 530 MB)

  A run's record is four keys beside the list: the set of its groups, each group's state when
  first registered (its baseline, which tells this run's failures from older ones), the
  candidates the listed consumer scans, and the groups pacing still counts. A group leaves all
  four once it has no waiting, running or claimed job, is not blocked and has no failure newer
  than its baseline. The listed consumer's scan (its bounded dispatch budget) and the pacing
  count (500 groups per Redis call) each forget the settled groups they meet. Staging a job
  re-registers its group, so a group that gets new work after it finished is waited on again. A
  failed or blocked group stays, so the barrier still names it. Closing the run deletes every
  key. A migration preflight's allow-list keeps its groups as before.

  Background:
    Given a GroupQueue with its Lua scripts deployed and a listed consumer

  @integration
  Scenario: A listed run over a hundred thousand groups keeps only its outstanding groups
    Given a listed run that sends one job to each of 100,000 groups, a page at a time
    When it waits for room after each page
    Then the run's group set, baselines and candidates hold no more groups than its outstanding jobs
    And the run returns once every job has run
    And none of the run's keys remain once it returns

  @integration
  Scenario: A group that gets new work after it finished is waited on again
    Given a listed run whose group has finished and been forgotten
    When the run sends that group another job that takes a while
    Then the group is back in the run's group set, baselines and candidates
    And the run returns only once that job has run

  @integration
  Scenario: A forgotten group that fails on new work still fails the run
    Given a listed run whose group has finished and been forgotten
    When the run sends that group a job that fails
    Then the run is refused naming that group
