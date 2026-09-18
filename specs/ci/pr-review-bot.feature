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

  @workflow @ci @unit
  Scenario: Dependabot PRs are skipped
    Given the pull request is authored by dependabot[bot]
    When the workflow runs
    Then the review job is skipped
    And no review is posted to the PR

  # ============================================================================
  # Gating: Fork PRs
  # ============================================================================

  @workflow @ci @unit
  Scenario: Pull requests from forks are skipped
    Given the pull request originates from a fork
    And the fork does not have access to repository secrets
    When the workflow runs
    Then the review job is skipped
    And no review is posted to the PR

  # ============================================================================
  # Gating: Draft PRs
  # ============================================================================

  @workflow @ci @unit
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

  @workflow @ci @unit
  Scenario: Review runs on pull request opened
    Given a pull request is opened in the same repository
    And the PR is not a draft
    And the PR author is not dependabot
    When the workflow runs
    Then the review job executes

  @workflow @ci @unit
  Scenario: Review runs on pull request synchronize
    Given a pull request is open in the same repository
    And new commits are pushed to the PR
    And the PR is not a draft
    And the PR author is not dependabot
    When the workflow runs
    Then the review job executes

  @workflow @ci @unit
  Scenario: Review runs on pull request reopened
    Given a pull request was previously closed
    And the PR is reopened
    And the PR is not a draft
    And the PR author is not dependabot
    When the workflow runs
    Then the review job executes

  @workflow @ci @unit
  Scenario: Review runs on ready for review
    Given a draft pull request exists
    And the draft is marked ready for review
    And the PR author is not dependabot
    When the workflow runs
    Then the review job executes

  # ============================================================================
  # Concurrency
  # ============================================================================

  @workflow @ci @unit
  Scenario: In-progress review is cancelled for the same PR
    Given a review is in progress for pull request #123
    And the same PR receives a new commit
    And the workflow is triggered again for #123
    When the new workflow run starts
    Then the previous review run is cancelled
    And only the latest review run proceeds
    And exactly one review result is posted for #123

  # ============================================================================
  # Action Pinning
  # ============================================================================
  #
  # Stated as an invariant rather than as named SHAs: a literal SHA in this
  # file goes stale the moment the workflow is repinned (dependabot /
  # renovate), and a feature file re-asserting a value CI has already moved
  # past is worse than no assertion — it reads as coverage that does not
  # exist.

  @workflow @ci @unit
  Scenario: Every action the workflow uses is pinned to a full commit SHA
    When the workflow runs
    Then every "uses:" step references a full 40-character commit SHA, never a tag or branch
    And every pinned step carries a trailing comment documenting what the pin means
