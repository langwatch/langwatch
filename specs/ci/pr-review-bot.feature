Feature: PR Review Bot workflow
  As a repository maintainer
  I want the PR Review Bot to selectively run code reviews on pull requests
  So that reviews are accurate, timely, and respect repository permissions

  # The workflow gates on three conditions to determine if a review should run:
  # (1) The PR is not from dependabot (Dependabot has separate secret management)
  # (2) The PR is from the same repository (forks cannot access repo secrets)
  # (3) The PR is not a draft (drafts are not ready for review)
  # Additionally, concurrency ensures only one review per PR runs at a time.

  Background:
    Given a pull request is created in the langwatch/langwatch repository
    And the PR Review Bot workflow is triggered

  # ============================================================================
  # Gating: Dependabot PRs
  # ============================================================================

  @workflow @ci
  Scenario: Dependabot PRs are skipped
    Given the pull request is authored by dependabot[bot]
    When the workflow runs
    Then the review job is skipped
    And no review is posted to the PR

  # ============================================================================
  # Gating: Fork PRs
  # ============================================================================

  @workflow @ci
  Scenario: Pull requests from forks are skipped
    Given the pull request originates from a fork
    And the fork does not have access to repository secrets
    When the workflow runs
    Then the review job is skipped
    And no review is posted to the PR

  # ============================================================================
  # Gating: Draft PRs
  # ============================================================================

  @workflow @ci
  Scenario: Draft pull requests are skipped
    Given the pull request is marked as draft
    When the workflow runs
    Then the review job is skipped
    And no review is posted to the PR

  # ============================================================================
  # Trigger Events
  # ============================================================================

  @workflow @ci
  Scenario: Review runs on pull request opened
    Given a pull request is opened in the same repository
    And the PR is not a draft
    And the PR author is not dependabot
    When the workflow runs
    Then the review job executes
    And a review is posted to the PR

  @workflow @ci
  Scenario: Review runs on pull request synchronize
    Given a pull request is open in the same repository
    And new commits are pushed to the PR
    And the PR is not a draft
    And the PR author is not dependabot
    When the workflow runs
    Then the review job executes
    And the review is updated on the PR

  @workflow @ci
  Scenario: Review runs on pull request reopened
    Given a pull request was previously closed
    And the PR is reopened
    And the PR is not a draft
    And the PR author is not dependabot
    When the workflow runs
    Then the review job executes
    And a review is posted to the PR

  @workflow @ci
  Scenario: Review runs on ready for review
    Given a draft pull request exists
    And the draft is marked ready for review
    And the PR author is not dependabot
    When the workflow runs
    Then the review job executes
    And a review is posted to the PR

  # ============================================================================
  # Concurrency
  # ============================================================================

  @workflow @ci
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

  @workflow @ci
  Scenario: Checkout action is pinned to full commit SHA
    When the workflow runs
    Then the checkout step uses actions/checkout pinned to commit 3d3c42e5aac5ba805825da76410c181273ba90b1
    And the SHA is a full 40-character commit hash
    And a version comment references the pin reason

  @workflow @ci
  Scenario: Review bot action is pinned to full commit SHA
    When the workflow runs
    Then the review bot action uses langwatch/langwatch-pr-review-bot pinned to commit 4bb3022896af5025953a78c6638b9ce516580e27
    And the SHA is a full 40-character commit hash
    And a version comment documents the pinned version
