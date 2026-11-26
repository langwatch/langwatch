Feature: Automation approves reviewed pull requests and flags the risky ones
  As a maintainer
  I want a PR to merge on tests, linters and the review bot, without waiting on a human
  So that nobody blocks a merge, and the daily change report still shows what risky change shipped

  # pr-auto-approve.yml approves low-risk and firefighting PRs on the
  # pull_request_target event. A PR that is not low risk gets the `needs-ack`
  # label and a comment saying why. pr-reviewed-approve.yml approves it once the
  # pr workflow has finished on its head commit. The decision tree is
  # .github/scripts/pr-auto-approve-decision.cjs, unit tested by
  # .github/scripts/pr-auto-approve-decision.test.ts.

  Background:
    Given a same-repository pull request whose pr workflow run finished on its head commit

  @unit
  Scenario: A risky PR the review bot passed is approved and flagged for acknowledgement
    Given the review bot's latest review of the head commit is a COMMENT with no P0/P1 finding
    And every required status check is green
    And the PR is not labelled low-risk-change
    When the reviewed-approval decision runs
    Then automation approves the head commit
    And the PR is labelled needs-ack

  @unit
  Scenario: A review bot REQUEST_CHANGES means no approval
    Given the review bot's latest review of the head commit is REQUEST_CHANGES
    When the reviewed-approval decision runs
    Then automation does not approve

  @unit
  Scenario: A review bot infrastructure error is not a verdict
    Given the review bot's latest review of the head commit is its infrastructure-error notice
    When the reviewed-approval decision runs
    Then automation does not approve

  @unit
  Scenario: A review of an older commit does not count
    Given the review bot's only clean review is of a commit before the head
    When the reviewed-approval decision runs
    Then automation does not approve

  @unit
  Scenario: A required check that failed or has not finished means no approval
    Given the review bot passed the head commit
    And a required status check failed or has no result yet
    When the reviewed-approval decision runs
    Then automation does not approve

  @unit
  Scenario: Required checks come from rulesets and branch protection, each from its own app
    Given the base branch names required checks in a ruleset and in branch protection, some pinned to an app
    And another app reports a passing run under a required check's name
    When the reviewed-approval decision runs
    Then every named check must pass on a run from the app it is pinned to
    And another app's run cannot stand in for it

  @unit
  Scenario: A PR that changes the review pipeline needs a human
    Given the review bot passed the head commit and every required check is green
    And the PR changes or renames a root-level file, anything under .github/, cmd/, tools/ or pkg/ciscan/, or a .claude/ directory, .mcp.json, CLAUDE.md, AGENTS.md, go.mod or go.sum at any depth
    When the reviewed-approval decision runs
    Then automation does not approve

  @unit
  Scenario: The decision is idempotent and ignores stale runs
    Given the head commit already has an approval, or the run is for an older head
    When the reviewed-approval decision runs
    Then automation does not approve again

  @unit
  Scenario: A low-risk PR the review bot passed is approved without the flag
    Given the PR is labelled low-risk-change but has no approval on the head commit
    And the review bot passed the head commit and every required check is green
    When the reviewed-approval decision runs
    Then automation approves the head commit
    And the PR is not labelled needs-ack

  @unit
  Scenario: Low risk needs every path on the allowlist, whatever the model says
    Given a PR that changes a path other than docs/, dev/docs/, specs/, a README or a raster image, or one in the review pipeline
    When the low-risk evaluation runs
    Then the PR does not qualify as low risk without asking the model

  @unit
  Scenario: Model text quoted into a comment cannot ping anyone or leave its quote
    Given the low-risk model's reasoning contains an @mention and a line break
    When it is put into the assessment comment
    Then the mention does not resolve and the text stays on one line
