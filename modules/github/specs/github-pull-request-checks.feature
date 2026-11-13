Feature: GitHub reports when the checks on a Langy pull request have finished
  The repository's own CI is where Langy measures a change it cannot run in its sandbox. GitHub
  announces each finished check suite; the GitHub module records one fact per commit once every
  check suite on a Langy branch's head commit has finished, so Langy can be woken to read the
  result. Only branches Langy opens (prefix langy/) on the repository itself are announced.

  Rule: A finished check suite on a Langy branch is announced once all checks finished

    @unit
    Scenario: The last check suite to finish on a Langy pull request records the fact
      Given an installation of the organization covering "acme/agent"
      And an open pull request 12 from branch "langy/fix-citations" on "acme/agent"
      And every check suite on the branch's head commit has finished, one of them failed
      When GitHub announces that a check suite on that commit completed
      Then a pull request checks completed fact is recorded for the organization
      And it names the repository, the branch, the commit, pull request 12 and the failed check

    @unit
    Scenario: A check suite that finishes while others still run records nothing
      Given a Langy pull request whose head commit has a check suite still running
      When GitHub announces that another check suite on that commit completed
      Then no fact is recorded

    @unit
    Scenario: A check suite with no check runs does not hold the announcement back
      Given a Langy pull request whose head commit has a queued check suite with no runs
      And every other check suite on that commit has finished
      When GitHub announces that a check suite on that commit completed
      Then the fact is recorded

    @unit
    Scenario: A commit with more check runs than one page is judged on all of them
      Given a Langy pull request whose head commit has more than 100 check runs
      When GitHub is asked about that commit's check runs
      Then every page of check runs is read
      And check runs past the pages read count as still running

    @unit
    Scenario: A branch Langy did not open is not announced
      Given a pull request from branch "feature/manual" on an installed repository
      When GitHub announces that a check suite on its head commit completed
      Then GitHub is not asked about the commit
      And no fact is recorded

    @unit
    Scenario: A pull request from a fork is not announced
      Given a pull request from a fork whose branch is named "langy/fix"
      When GitHub announces that a check suite on its head commit completed
      Then no fact is recorded

    @unit
    Scenario: A closed pull request is not announced
      Given a pull request from branch "langy/fix" that was closed
      And every check suite on its head commit has finished
      When GitHub announces that a check suite on that commit completed
      Then no fact is recorded

    @unit
    Scenario: A check suite from an installation no organization connected is dropped
      Given a check suite announcement for an installation LangWatch has no record of
      When it is applied
      Then no fact is recorded and the delivery is still acknowledged

    @unit
    Scenario: A check suite that is not completed is ignored
      Given a check suite announcement whose action is requested
      When it is applied
      Then GitHub is not asked about the commit

    @unit
    Scenario: A failure to read the commit's checks is logged and acknowledged
      Given a Langy pull request whose commit checks GitHub refuses to list
      When GitHub announces that a check suite on that commit completed
      Then no fact is recorded and the delivery is still acknowledged

  Rule: A turn's token asks for what the installation granted, CI access included

    @unit
    Scenario: A turn token includes CI access the installation granted
      Given an installation that granted contents, pull requests, actions, checks and workflows
      When a turn token is minted
      Then it asks for contents and pull requests write, actions write, checks read and workflows write

    @unit
    Scenario: A turn token leaves out what an older installation never granted
      Given an installation that granted only contents and pull requests write
      When a turn token is minted
      Then it asks for contents and pull requests write only
      And the mint still succeeds

    @unit
    Scenario: A turn token never asks for more than the installation granted
      Given an installation that granted actions read only
      When a turn token is minted
      Then it asks for actions read, not actions write

    @unit
    Scenario: A turn token for one repository is minted for that repository only
      Given an installation covering "acme/agent" and "acme/web"
      When a turn token is minted for "acme/agent"
      Then the token is scoped to the repository id of "acme/agent"
