Feature: Pull request checks wait for a quiet branch, and main runs them once a day
  Agents push to a branch several times a minute, and every push used to start
  about 18 workflow runs. pr.yml now runs the cheap checks at once and holds the
  rest until the branch has been quiet for the settle environment's wait timer;
  a newer push cancels the wait. A merge to main runs only the app checks; the
  nightly suite runs every check on main. Plan: dev/docs/plans/ci-redesign.md

  @unit
  Scenario: Heavy checks wait until the branch has been quiet
    Given a check pr.yml calls
    When its job is read
    Then it needs the settle job and runs only when settle did not fail

  @unit
  Scenario: The ci:now label skips the wait
    Given a pull request labelled ci:now or firefighting
    When the changes job reads its labels from GitHub, not from the event
    Then settle is skipped and the checks start at once

  @unit
  Scenario: The cheap checks run at once
    Given the checks that used to be a workflow each: screenshots, README links, impact map and token usage
    When pr.yml runs
    Then they run as steps of one job that does not wait for settle

  @unit
  Scenario: A merge to main runs only the app checks
    Given the checks pr.yml calls
    When a pull request merges to main
    Then only the app checks start
    And the nightly suite runs pr.yml on main for every check
