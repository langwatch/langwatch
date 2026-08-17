Feature: In-place authorization data migration
  As the LangWatch platform
  I need legacy team-membership rows promoted to role bindings by the system
  itself, organization by organization, while it runs
  So that self-hosted installations migrate silently in the background and
  cloud rollout is paced by us, with no operator ever running a script

  # Stage B of ADR-092 (see dev/docs/plans/adr-092-authz-delivery-plan.md,
  # runbook rows M1/M2). The migration is IN-PLACE: a runner hosted in the
  # worker process performs the one-time backfill when the system boots.
  # Nothing here has a customer-facing failure surface by design - every
  # failure parks the organization on the legacy path, which keeps behaving
  # exactly as before. That is why this feature declares no error codes: the
  # only "error path" a customer could ever observe is the absence of any
  # change at all.
  #
  # Per-organization state machine, one-way:
  #
  #   pending ──► migrated ──► finalized      (parity clean: legacy fallback
  #     │             ▲            │           no longer consulted)
  #     │             │            ▼
  #     │             │        rolled_back    (operator only: back on the
  #     │             │                        legacy path, and pinned there)
  #     │             │ diffs recorded, held
  #     └──► parked ──┘                       (error: retried on a later pass)
  #
  # "Migrated" holds bindings AND legacy rows; behaviour is unchanged until
  # "finalized", and finalization requires a decision-level parity proof.

  Background:
    Given an organization "acme" with a team "support"
    And a user "sam" whose membership exists only as a legacy team row

  # ============================================================================
  # The runner
  # ============================================================================

  @unit
  Scenario: One process drives the migration at a time
    Given two worker processes boot at the same moment
    When both attempt to start the migration pass
    Then exactly one acquires the lease and processes organizations
    And the other stands down without touching any state

  @unit
  Scenario: A self-hosted installation migrates every organization automatically
    Given the installation is self-hosted
    When the workers boot
    Then every organization is processed with no configuration required

  @unit
  Scenario: Cloud rollout processes only the configured cohort
    Given the installation is cloud and the cohort names "acme"
    When the migration pass runs over "acme" and "globex"
    Then "acme" is processed
    And "globex" is left untouched with no state recorded

  @unit
  Scenario: An organization that fails mid-migration is parked and retried
    Given the backfill for "acme" fails with a storage error
    When the migration pass reaches "acme"
    Then "acme" is recorded as parked with the error in its report
    And the next pass attempts "acme" again
    And permission checks in "acme" keep answering exactly as before throughout

  @unit
  Scenario: A finalized organization is never processed again
    Given "acme" was finalized on an earlier pass
    When a later pass runs
    Then "acme" is skipped without any backfill or parity work

  @unit
  Scenario: An operator rolls a finalized organization back to its legacy path
    Given "acme" was finalized
    When an operator records "acme" as rolled back
    Then permission checks in "acme" consult the legacy fallback again
    And later passes leave "acme" alone instead of re-finalizing it

  @unit
  Scenario: The pass keeps its lease while one large organization migrates
    Given migrating "acme" takes longer than a single lease term
    When the pass is working through "acme"
    Then the lease is renewed for as long as the pass runs
    And a lease lost to another process stops this pass at the next
      organization

  # ============================================================================
  # The backfill (runbook M1)
  # ============================================================================

  @unit
  Scenario: A legacy team row gains an equivalent team-scoped binding
    When the migration processes "acme"
    Then "sam" holds a role binding at team "support" with the same role
    And the binding's custom role is the legacy row's assigned role
    And the legacy row itself is not deleted

  @unit
  Scenario: Running the backfill twice creates nothing new
    Given the migration already processed "acme"
    When the migration processes "acme" again
    Then no additional bindings are created

  @unit
  Scenario: Personal workspace teams keep their bindings team-scoped
    Given "sam" owns a personal workspace team in "acme"
    When the migration processes "acme"
    Then the workspace binding stays scoped to the personal team
    And no organization-scoped binding is minted from it

  @unit
  Scenario: The backfill bumps the organization's authorization epoch once
    When the migration processes "acme"
    Then the epoch for "acme" is bumped after the bindings are written
    And an audit event records the backfill with its counts

  @unit
  Scenario: A custom role already bound at the team is recognised, whatever its role column says
    Given "sam" already holds a binding for custom role "auditor" at team
      "support"
    And the legacy row names the same custom role under a different role name
    When the migration processes "acme"
    Then no second binding is attempted for that custom role at that team
    And the backfill count reports only what was actually written

  @unit
  Scenario: A migration that died after writing publishes its work on the retry
    Given an earlier pass wrote "acme"'s bindings and then parked before
      bumping the epoch
    When a later pass processes "acme"
    Then the epoch for "acme" is bumped even though no binding was missing
    And no duplicate bindings are created

  # ============================================================================
  # The parity proof and the per-organization switch
  # ============================================================================

  @unit
  Scenario: Legacy membership rows resolve identically before finalization
    When the migration verifies "acme"
    Then every member's effective decisions are computed twice, with and
      without the legacy rows
    And "acme" is finalized only when the two runs agree on every decision

  @unit
  Scenario: An organization relying on the legacy org-level union is held, not broken
    Given "sam"'s legacy team row grants an organization-level permission that
      no binding grants
    When the migration verifies "acme"
    Then "acme" is recorded as migrated with the disagreement in its report
    And "acme" is not finalized
    And "sam" keeps that permission because the legacy path stays live

  @unit
  Scenario: A proof interrupted by shutdown parks the organization
    Given the workers shut down while "acme"'s parity proof is part-way through
    When the proof is interrupted
    Then "acme" is parked rather than finalized on an unfinished proof
    And the next pass verifies "acme" from the start

  @integration
  Scenario: A finalized organization stops consulting the legacy fallback
    Given "acme" was finalized
    When a permission check runs for a member of "acme"
    Then the answer comes from role bindings alone
    And the legacy team rows are not read

  @integration
  Scenario: An organization that is not finalized keeps today's behaviour exactly
    Given "acme" is pending, migrated, or parked
    When a permission check runs for a member of "acme"
    Then the legacy fallback participates exactly as it does today

  @unit
  Scenario: A held organization heals itself once the gap is granted
    Given "acme" was held for a disagreement on one permission
    And an admin later grants that permission through a binding
    When a later migration pass verifies "acme"
    Then "acme" is finalized without any manual state change
