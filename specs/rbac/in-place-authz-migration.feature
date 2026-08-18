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
  # The migration itself has no customer-facing failure surface by design -
  # every import failure parks the organization on the legacy path, which
  # keeps behaving exactly as before. One error code exists past the flip:
  # once an organization's grant writes ride the ledger, a write attempted
  # while the event-sourcing stack is unavailable refuses with
  # "authz_ledger_unavailable" (503, platform fault) instead of
  # half-happening; permission checks are unaffected.
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

  @unit
  Scenario: A finalized organization stops consulting the legacy fallback
    Given "acme" was finalized
    When a permission check runs for a member of "acme"
    Then the answer comes from role bindings alone
    And the legacy team rows are not read

  @unit
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
  # The genesis import (ADR-092 §13 - the grants state becomes event-derived)
  # ============================================================================
  # Before the ledger can be the only writer, everything that already exists
  # has to be something the ledger said. The import states every existing
  # binding, custom role and membership fact as an event backdated to the
  # row's own creation time - and it ADOPTS rather than re-creates: the
  # legacy row's id becomes the fact's id, so the identity customers already
  # hold survives, and the compat view stays byte-for-byte what it was.

  @unit
  Scenario: Existing grants become ledger facts under the ids they already have
    Given "acme" holds role bindings and custom roles written before the ledger
    When the genesis import runs for "acme"
    Then each binding is stated as a fact carrying that binding's own id
    And each custom role is stated as a role fact carrying that role's own id
    And every fact carries the business time of the row it came from

  @unit
  Scenario: The import proves itself against the rows it started from
    Given the genesis import emitted every fact for "acme"
    When the import re-reads the compat view
    Then "acme" is finalized only when every original row is still there,
      field for field

  @unit
  Scenario: A compat view that no longer reproduces a legacy row holds the organization
    Given the compat view for "acme" has drifted from one of its legacy rows
    When the import re-reads the compat view
    Then "acme" is held with the drift named in a bounded report
    And "acme" is not finalized

  @unit
  Scenario: The organization member floor becomes a grant the organization holds
    Given "acme" has members whose only access is the organization's baseline
    When the genesis import runs for "acme"
    Then the organization itself holds one member grant at "acme"
    And that grant carries the organization's own creation time

  @unit
  Scenario: A legacy organization admin with no bindings states its access
    Given "acme" has an ADMIN membership row whose user holds no binding
    When the genesis import runs for "acme"
    Then that user holds an organization-scoped admin grant
    And a member with no bindings gains nothing beyond the floor

  @unit
  Scenario: Running the genesis import twice states the same facts
    Given the genesis import already ran for "acme"
    When it runs again
    Then the same fact ids are emitted, so the import converges rather than
      duplicating

  @unit
  Scenario: An imported grant updates the row it adopted and never authors a new one
    Given a legacy binding row adopted by the genesis import
    When the fold stores that grant
    Then the existing compat row is updated in place
    And no second compat row is created for it

  # ============================================================================
  # One writer (ADR-092 §13 - the ledger becomes the only writer)
  # ============================================================================
  # From here on no application code writes a grant table. Every write path -
  # role bindings, roles, invites, groups, keys, SCIM - emits a command, and
  # both the new head and the legacy-shaped compat row are written by the fold
  # that follows. That is what makes replay honest: the tables cannot hold
  # anything the ledger never said.

  @unit
  Scenario: A grant write states a fact instead of writing the table
    When an admin attaches a role binding
    Then the write path emits an attach command
    And it writes no binding row of its own

  @unit
  Scenario: The compat rows are authored by the fold alone
    Given a grant fact from a live write path
    When the fold stores it
    Then the legacy-shaped binding row is written by the fold

  @integration
  Scenario: A live grant write lands both projected heads through the real fold
    Given an organization whose grant writes go through the ledger
    When an admin attaches a role binding
    Then the projected grant row and its legacy-shaped binding row both land
    And a fact the legacy tables cannot express lands the grant row alone

  # ============================================================================
  # Per-organization write cutover (ADR-092 decision 4)
  # ============================================================================
  # "One writer" arrives the same way every other change in this feature does:
  # one organization at a time, never all at once. The code above ships to
  # production gated closed - an organization's grant writes move onto the
  # ledger only when its own genesis import has landed, and everyone else keeps
  # the imperative writes, audit rows included, exactly as before. A deploy
  # therefore changes nobody's behaviour, and putting an organization back is
  # the operator's flip on its state row rather than a release. Rows written
  # imperatively meanwhile are adopted by the next genesis pass, so flipping
  # back and forth converges instead of diverging.

  @unit
  Scenario: An organization that has not completed the genesis import keeps writing legacy rows imperatively
    Given "acme" has no completed genesis import
    When an admin attaches, changes, revokes, or defines a grant in "acme"
    Then the row is written directly, as it was before the ledger
    And no command is emitted for it

  @unit
  Scenario: Completing the genesis import moves an organization's writes onto the ledger
    Given the genesis import for "acme" has completed
    When an admin attaches, revokes, or defines a grant in "acme"
    Then the write emits a command
    And it writes no grant table row of its own

  @unit
  Scenario: The operator rollback returns an organization's writes to the legacy path without a deploy
    Given "acme" was writing through the ledger
    When an operator records its genesis import as rolled back
    Then its writes return to the imperative path with no deploy

  @unit
  Scenario: A write on the legacy path still records its audit row
    Given "acme" has no completed genesis import
    When an admin attaches a role binding
    Then an audit row is recorded naming the actor, the organization, and the
      fact
    And it has the same shape the ledger's subscriber writes

  # ============================================================================
  # The audit trail as an event subscriber (ADR-092 decision 17)
  # ============================================================================
  # The audit page, its table and its retention are unchanged; what feeds it
  # moves. Write paths stop writing audit rows, and one insert-only subscriber
  # writes a row per runtime fact - never an update, and never for the
  # backdated facts a migration states, which would otherwise flood the page
  # with years of history on the day an organization migrates.

  @unit
  Scenario: A grant a person made is recorded in the audit trail
    Given an admin attaches a role binding
    When the fact reaches the audit subscriber
    Then one audit row is written naming the actor, the organization, and the
      fact

  @unit
  Scenario: The migration's own facts never reach the audit trail
    Given facts stated by the genesis import, the backfill, or a read-through
      mint
    When they reach the audit subscriber
    Then no audit row is written for them
    And a fact from a live write path still writes its row

  @unit
  Scenario: A fact delivered twice writes one audit row
    Given an audit row was written for a fact
    When the same fact is delivered again
    Then the row id is the same and the second insert is dropped

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

  # One writer, one refusal: for an organization on ledger writes, a grant
  # write with no event-sourcing stack refuses rather than half-happening.
  @unit
  Scenario: A migrated organization's grant write refuses while the ledger is unavailable
    Given an organization whose grant writes ride the ledger
    And the event-sourcing stack is unavailable to the process
    When a grant write is attempted
    Then the write is refused with error code "authz_ledger_unavailable"
    And a retry after the stack returns is not poisoned by the refusal
