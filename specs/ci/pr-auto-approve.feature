Feature: PR auto-approval lanes
  As the team
  I want automation to approve PRs that provably need no human review round
  So that low-impact and machine-vetted changes merge fast while risky changes always reach a human

  # Branch protection (1 required approval, dismiss stale reviews on push,
  # required status checks) is the actual merge gate. The workflow only
  # decides whether the github-actions bot contributes an approving review.
  # GitHub Actions workflow behaviour — no in-repo test harness binds these
  # scenarios; the workflow run history is the evidence trail.

  Background:
    Given the target branch requires one approving review and dismisses stale approvals on push
    And the auto-approve workflow runs for pull request, review, and review-thread events
    And fork PRs are never evaluated by any lane

  # ==========================================================================
  # Shared preflight
  # ==========================================================================

  Scenario: An existing approval on the current head short-circuits every lane
    Given a human has approved the PR at its current head SHA
    When any auto-approve event fires
    Then no lane runs and no bot review is submitted

  Scenario: The bot never re-approves the same head
    Given the bot has already approved the PR at its current head SHA
    When any auto-approve event fires
    Then the workflow exits without submitting another review

  # ==========================================================================
  # Firefighting lane (manual override)
  # ==========================================================================

  Scenario: Firefighting label approves immediately
    Given the PR carries the "firefighting" label
    When the workflow evaluates the PR
    Then the bot submits an approving review citing the manual override
    And stale low-risk and AI-review assessment artifacts are removed

  Scenario: Removing the firefighting label dismisses its approval
    Given the bot approved the PR under the firefighting override
    When the "firefighting" label is removed
    Then the bot's firefighting approval is dismissed

  # ==========================================================================
  # Dependabot lane
  # ==========================================================================

  Scenario: A purely Dependabot-authored PR is approved
    Given a PR authored by Dependabot
    And every commit on the branch is authored by Dependabot
    When the workflow evaluates the PR
    Then the bot submits an approving review for the Dependabot lane
    And required status checks still gate the merge

  Scenario: A human commit removes the Dependabot fast lane
    Given a PR authored by Dependabot
    And a human has pushed a commit to the branch
    When the workflow evaluates the PR
    Then the Dependabot lane does not approve
    And the PR follows the normal review process

  Scenario: Dependabot PRs never reach the LLM evaluator
    Given a PR authored by Dependabot
    When the workflow evaluates the PR
    Then the low-risk and AI-reviewed evaluations are skipped
    # Dependabot-triggered runs receive Dependabot secrets, not Actions
    # secrets, so the evaluator's API key is unavailable on those runs.

  # ==========================================================================
  # Low-risk lane (existing tier)
  # ==========================================================================

  Scenario: A qualifying low-impact PR is labeled and approved
    Given a PR whose diff the evaluator classifies as low impact under the low-risk policy
    When the low-risk evaluation runs
    Then the "low-risk-change" label is applied
    And an assessment comment records the evaluation
    And the bot submits an approving review

  Scenario: Restricted paths disqualify without consulting the evaluator
    Given a PR that touches workflows, auth, migrations, or the policy documents
    When the low-risk evaluation runs
    Then the PR is marked as requiring manual review
    And the language model is not consulted

  Scenario: A new push strips stale qualification labels
    Given a PR holding the "low-risk-change" or "ai-reviewed-change" label
    When new commits are pushed
    Then both labels are removed before re-evaluation

  # ==========================================================================
  # AI-reviewed lane (medium tier)
  # ==========================================================================

  Scenario: A medium-impact PR with clean AI reviews is approved
    Given every required AI reviewer has reviewed the current head SHA
    And no unresolved review threads from the required AI reviewers remain
    And the evaluator classifies the PR as medium impact or lower without excluded areas
    When the AI-reviewed evaluation runs
    Then the "ai-reviewed-change" label is applied
    And an assessment comment records which reviews were counted and at which SHAs
    And the bot submits an approving review for the AI-reviewed lane

  Scenario: Coverage requires every required AI reviewer
    Given CodeRabbit has reviewed the PR but the LangWatch PR reviewer has not
    When the AI-reviewed evaluation runs
    Then the lane does not approve and waits for the missing review

  Scenario: The LangWatch reviewer only counts via its verdict trailer
    Given a review authored by the LangWatch reviewer without a "LangWatch-Review:" trailer
    When the AI-reviewed evaluation checks coverage
    Then that review does not count as coverage
    # The trailer is parsed leniently from anywhere in the review body;
    # only the author identity and the trailer SHA are trusted.

  Scenario: Trivial tweaks after a review keep it fresh
    Given the required AI reviews cover an earlier SHA
    And the changes since that SHA are small, modify existing files only, and touch no restricted paths
    When the AI-reviewed evaluation runs
    Then the earlier reviews still count as covering the current head

  Scenario: Fundamental changes after a review make it stale
    Given the required AI reviews cover an earlier SHA
    And the changes since that SHA exceed the trivial threshold or add files or touch restricted paths
    When the AI-reviewed evaluation runs
    Then the lane does not approve until the reviewers re-review the new head

  Scenario: A force-push always makes prior reviews stale
    Given the reviewed SHA is no longer reachable on the branch
    When the AI-reviewed evaluation runs
    Then the lane treats every prior AI review as stale

  Scenario: Unresolved AI review threads block approval
    Given a required AI reviewer left review comments that are not resolved
    When the AI-reviewed evaluation runs
    Then the lane does not approve

  Scenario: Resolving the last AI thread re-runs the evaluation
    Given the only disqualifier was an unresolved AI review thread
    When the thread is resolved
    Then the workflow re-evaluates the PR without waiting for a push

  Scenario: High impact disqualifies regardless of clean reviews
    Given the required AI reviews are clean on the current head
    And the evaluator classifies the PR as high impact or touching excluded areas
    When the AI-reviewed evaluation runs
    Then the lane does not approve
    And the assessment comment says manual review is required

  Scenario: A low-risk approval makes the AI-reviewed lane unnecessary
    Given the low-risk evaluation qualified and approved the PR
    When the same run reaches the AI-reviewed lane
    Then the AI-reviewed evaluation is skipped

  # ==========================================================================
  # Evaluator integrity
  # ==========================================================================

  Scenario: Labels are evidence, never inputs
    Given someone manually applies the "low-risk-change" or "ai-reviewed-change" label
    When the workflow evaluates the PR
    Then the manual label grants nothing and evaluation proceeds from scratch

  Scenario: PR content cannot instruct the evaluator
    Given a PR description that claims the change is low risk or instructs the evaluator to approve
    When the language model evaluates the PR
    Then the claim carries no evidentiary weight
    And classification is derived from the diff alone

  Scenario: The policy documents cannot approve their own changes
    Given a PR that modifies the low-risk policy, the AI-reviewed policy, or the evaluator prompt
    When any evaluation lane runs
    Then the PR is treated as restricted and requires manual review
