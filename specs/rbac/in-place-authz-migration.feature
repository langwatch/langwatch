Feature: In-place authorization data migration
  As the LangWatch platform
  I need legacy team-membership rows promoted to role bindings by the system
  itself, organization by organization, while it runs
  So that self-hosted installations migrate silently in the background and
  cloud rollout is paced by us, with no operator ever running a script

  # Stage B of ADR-092, now the head of the grants-ledger delivery
  # (see dev/docs/plans/adr-092-authz-delivery-plan.md, "The PR map").
  # The migration is IN-PLACE: a runner hosted in the
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

  # ============================================================================
  # Shadow comparison observability (stage A)
  # ============================================================================
  # The rollout's gate is days of shadow logs, so the logs must prove the
  # comparison is running at all: enabling shadow is announced, every
  # comparison logs its outcome, and a failed comparison is a warning -
  # never a debug line invisible at production log level.

  @unit
  Scenario: Every shadow comparison is visible in the logs
    Given shadow comparison is enabled
    When a permission check runs through a legacy resolver
    Then agreement between the two resolvers is logged as routine
    And disagreement is logged as a warning carrying both verdicts

  @unit
  Scenario: Turning shadow comparison on is itself announced
    Given shadow comparison was off
    When the sample rate changes
    Then the new rate is announced once, not on every check
    And turning it off again is announced too

  @unit
  Scenario: A shadow comparison that fails is a warning, not silence
    Given shadow comparison is enabled
    When the engine's comparison throws
    Then the failure is logged as a warning naming the caller
    And the response the customer received is unaffected

  # ============================================================================
  # The cutover as ledger facts (ADR-092 §13 - the grants ledger)
  # ============================================================================
  # The state machine above is unchanged; what changes underneath is that
  # its transitions become process events in the ledger, and the state
  # table becomes their projection. These scenarios cover only what is new.

  @unit
  Scenario: Replaying an organization's stream reproduces the writer's rows
    Given the same legacy team rows for "acme"
    When the emission, command, fold, and row mappings run twice
    Then both runs produce byte-identical grant and binding rows
    And each legacy row lands as an equivalent binding, identity keys intact

  @unit
  Scenario: Runner lifecycle transitions are witnessed as ledger facts
    Given the runner records a state transition for "acme"
    When the state is written
    Then the write is synchronous and remains the finalized latch
    And the same transition is recorded as a ledger fact after the write

  @unit
  Scenario: A lost witness never loses a transition
    Given recording the ledger fact fails
    When the runner writes a state transition for "acme"
    Then the state write holds and the pass continues
    And the loss costs replay fidelity for one transition, never correctness

  @integration @unimplemented
  Scenario: A clean parity proof and the cutover are recorded as facts
    Given the migration verified "acme" with no disagreement
    When "acme" is cut over
    Then the ledger records the parity proof with its empty diff list
    And the ledger records the cutover with its actor
    And the projection the permission fork reads marks "acme" as on the engine

  @integration @unimplemented
  Scenario: Rolling back a cutover takes effect without a deploy, even with the queue stopped
    Given "acme" was cut over and is served by the engine
    And the queue infrastructure is stopped
    When an operator rolls "acme" back
    Then the rollback is recorded and applied before the call returns
    And permission checks in "acme" consult the legacy path within the gate's cache window

  @integration @unimplemented
  Scenario: Cutover imports the legacy facts that only exist outside bindings
    Given "acme" has a member whose only admin fact is a legacy organization ADMIN row
    And "acme" has a share link and an operator listed in the platform admin list
    When "acme" is cut over
    Then the legacy admin holds an organization-scoped admin grant
    And the share link is a resource-scope grant with its token and expiry intact
    And the operator holds a platform-scope grant
    And every imported grant carries the business time of the fact it came from

  # ============================================================================
  # Read-through minting for legacy keys (ADR-092 decision 1 - no key sunset)
  # ============================================================================
  # Old keys keep working with no deadline and no customer action. What moves
  # is where their access LIVES: a key whose access was implicit states it as
  # a fact the first time it authenticates, so the same access survives the
  # day the engine decides. The mint rides authentication and can never fail
  # it.

  @unit
  Scenario: A legacy service key states its access the first time it is used
    Given a service key with no grants of its own
    When the key authenticates
    Then the ledger records its organization-scoped admin grant
    And the fact carries the source "read-through-mint" and the system actor
    And the grant's business time is the key's own creation time

  @unit
  Scenario: The mint never holds up the request that triggered it
    Given a service key with no grants of its own
    When the key authenticates
    Then authentication answers without waiting for the projection

  @unit
  Scenario: A key that already states its access mints nothing
    Given a key that holds a grant
    When the key authenticates
    Then no fact is recorded

  @unit
  Scenario: A key owned by a user mints nothing it did not already have
    Given a key owned by a user and holding no grant
    When the key authenticates
    Then no fact is recorded

  @unit
  Scenario: A key that is busy authenticating mints once, not once per request
    Given a service key with no grants of its own
    When the key authenticates twice before the projection lands
    Then exactly one fact is recorded

  @unit
  Scenario: A mint that fails leaves the credential working
    Given the ledger refuses the write
    When a legacy service key authenticates
    Then the key still resolves
    And the failure is a warning, retried on the key's next use
