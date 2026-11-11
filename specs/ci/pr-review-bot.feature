Feature: PR Review Bot workflow
  As a repository maintainer
  I want the PR Review Bot to selectively run code reviews on pull requests
  So that reviews are accurate, timely, and respect repository permissions

  # The review is the job `review` in pr.yml, the last job, so it spends tokens
  # only on a change CI passed. The ruleset requires a check of that name.
  #
  # The job gates on these conditions to determine whether it runs at all:
  # (1) The PR is not from dependabot (Dependabot has separate secret management)
  # (2) The PR is from the same repository (forks cannot access repo secrets)
  # (3) The PR is not a draft (drafts are not ready for review)
  # (4) ci-complete succeeded, and then every other check on the head commit
  #     (the separate workflows: pr conventions, go-ci, code-scanners, ...) has
  #     finished without failing
  # (5) The event is a pull request (the bot reads github.event.pull_request)
  # Additionally, concurrency ensures only one review per PR runs at a time.
  #
  # Whether a job that runs actually POSTS a review is decided inside
  # langwatch/langwatch-pr-review-bot (a separate repository, including any
  # base-branch restriction it applies) — this workflow's gate can only
  # promise that its own job ran, not that a review lands.

  Background:
    Given a pull request is created in the langwatch/langwatch repository
    And the pr workflow is triggered

  # ============================================================================
  # Gating: CI
  # ============================================================================

  @unit
  Scenario: The review starts only after CI passed
    Given a check pr.yml calls failed for the pull request
    When ci-complete fails
    Then the review job is skipped
    And no review is posted to the PR

  @unit
  Scenario: The review still starts when CI skipped checks the change does not reach
    Given pr.yml skipped the checks the change does not reach
    When ci-complete succeeds
    Then the review job executes

  @unit
  Scenario: The merge queue gets no review
    Given a merge queue run of pr.yml
    When ci-complete succeeds
    Then the review job is skipped

  # ============================================================================
  # Gating: the other workflows' checks
  # ============================================================================
  #
  # ci-complete covers only the calls of pr.yml. The review job's first step
  # lists the head commit's check runs, waits while any is unfinished, and gives
  # the go-ahead only when none failed; every action step of the job needs it.
  # A new push cancels the run (see Concurrency) and with it the wait.

  @unit
  Scenario: The review waits for every other check on the head commit
    Given CI passed and another workflow's check on the head commit is still running
    When the review job starts
    Then its wait step keeps polling the check runs
    And no review is posted until that check has finished

  @unit
  Scenario: The review does not start when another check failed
    Given CI passed and another workflow's check on the head commit failed
    When the wait step reads the check runs
    Then the review steps are skipped
    And no review is posted to the PR

  # ============================================================================
  # Gating: Dependabot PRs
  # ============================================================================

  @unit
  Scenario: Dependabot PRs are skipped
    Given the pull request is authored by dependabot[bot]
    When the workflow runs
    Then the review job is skipped
    And no review is posted to the PR

  # ============================================================================
  # Gating: Fork PRs
  # ============================================================================

  @unit
  Scenario: Pull requests from forks are skipped
    Given the pull request originates from a fork
    And the fork does not have access to repository secrets
    When the workflow runs
    Then the review job is skipped
    And no review is posted to the PR

  # ============================================================================
  # Gating: Draft PRs
  # ============================================================================

  @unit
  Scenario: Draft pull requests are skipped
    Given the pull request is marked as draft
    When the workflow runs
    Then the review job is skipped
    And no review is posted to the PR

  # ============================================================================
  # Trigger Events
  # ============================================================================
  #
  # Each scenario below asserts the workflow's own gate lets the job run for
  # that event — not that a review is posted, since posting is decided by
  # langwatch-pr-review-bot outside this repository.

  @unit
  Scenario: Review runs on pull request opened
    Given a pull request is opened in the same repository
    And the PR is not a draft
    And the PR author is not dependabot
    When the workflow runs
    Then the review job executes

  @unit
  Scenario: Review runs on pull request synchronize
    Given a pull request is open in the same repository
    And new commits are pushed to the PR
    And the PR is not a draft
    And the PR author is not dependabot
    When the workflow runs
    Then the review job executes

  @unit
  Scenario: Review runs on pull request reopened
    Given a pull request was previously closed
    And the PR is reopened
    And the PR is not a draft
    And the PR author is not dependabot
    When the workflow runs
    Then the review job executes

  @unit
  Scenario: Review runs on ready for review
    Given a draft pull request exists
    And the draft is marked ready for review
    And the PR author is not dependabot
    When the workflow runs
    Then the review job executes

  # ============================================================================
  # Concurrency
  # ============================================================================

  # The guard cannot observe a run being canceled; it asserts the workflow
  # configuration that makes GitHub cancel one — a concurrency group keyed on
  # the PR number, with cancel-in-progress: true.
  @unit
  Scenario: In-progress review is canceled for the same PR
    Given the concurrency group is keyed on github.event.pull_request.number
    And cancel-in-progress is set to true
    When a new run for a PR starts while an earlier run for that same PR is in progress
    Then GitHub cancels the earlier run for that PR

  # ============================================================================
  # Permissions
  # ============================================================================

  # contents: write is required so the default GITHUB_TOKEN can call
  # resolveReviewThread; anything less only loses thread auto-resolution.
  @unit
  Scenario: The review workflow grants exactly checks read, contents write and pull-requests write
    When the workflow runs
    Then the workflow grants permissions: checks: read, contents: write, pull-requests: write
    And the workflow does not grant any extra permissions

  # ============================================================================
  # Action Pinning
  # ============================================================================
  #
  # Stated as an invariant rather than as named SHAs: a literal SHA in this
  # file goes stale the moment the workflow is repinned (dependabot /
  # renovate), and a feature file re-asserting a value CI has already moved
  # past is worse than no assertion — it reads as coverage that does not
  # exist.

  @unit
  Scenario: Every action the workflow uses is pinned to a full commit SHA
    When the workflow runs
    Then every "uses:" step references a full 40-character commit SHA, never a tag or branch
    And every pinned step carries a trailing comment documenting what the pin means

  @unit
  Scenario: Local composite actions are left out of the pin check
    Given a step whose "uses:" value starts with "./"
    When the workflow runs
    Then the pin check reports nothing for that step, because a local action has no ref to pin
