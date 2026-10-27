Feature: PR Review Bot workflow
  As a repository maintainer
  I want the PR Review Bot to selectively run code reviews on pull requests
  So that reviews are accurate, timely, and respect repository permissions

  # The workflow gates on three conditions to determine whether the review
  # job runs at all:
  # (1) The PR is not from dependabot (Dependabot has separate secret management)
  # (2) The PR is from the same repository (forks cannot access repo secrets)
  # (3) The PR is not a draft (drafts are not ready for review)
  # Additionally, concurrency ensures only one review per PR runs at a time.
  #
  # Whether a job that runs actually POSTS a review is decided inside
  # langwatch/langwatch-pr-review-bot (a separate repository, including any
  # base-branch restriction it applies) — this workflow's gate can only
  # promise that its own job ran, not that a review lands.

  Background:
    Given a pull request is created in the langwatch/langwatch repository
    And the PR Review Bot workflow is triggered

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
  Scenario: The review workflow grants exactly contents write and pull-requests write
    When the workflow runs
    Then the workflow grants permissions: contents: write, pull-requests: write
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
