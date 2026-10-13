Feature: Unproven accounts an older image finalized are reopened once it is gone
  As an operator rolling out the identifier model
  I want a second reopen sweep after the old writers have stopped
  So that an older pod's restart cannot leave an unproven account finalized

  @unit
  Scenario: The after-rollout step is a background step that waits for old writers to go
    Given identity's upgrade steps are declared
    Then "identity:reopen-unproven-accounts-after-rollout" is a background step
    And it waits until no older image serves

  @unit
  Scenario: The after-rollout step sweeps unproven accounts back to the legacy path
    Given no unproven account is finalized
    When the after-rollout step runs
    Then it reports no account reopened
    And a dry run reports no account it would reopen

  # Only an account carrying a sign-in method set before the proof is reopened: one
  # carrying only its address has nothing for adoption to wipe (Alex, 2026-10-11).
  @unit
  Scenario: The reopen sweep leaves an unproven account carrying only its address finalized
    Given an unproven account carrying a password and one carrying only its address are finalized
    When the reopen sweep runs
    Then the one carrying a password is reopened
    And the one carrying only its address stays finalized
