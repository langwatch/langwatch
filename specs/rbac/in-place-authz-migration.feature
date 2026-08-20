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
  #   pending ──► migrated ──► finalized      (parity clean at the team and
  #     │             │  ▲          │           project scopes the bindings
  #     │             │  │          │           replace; the legacy fallback
  #     │             │  │          │           stays live until contract)
  #     │             │  │          ▼
  #     │             └──┼───►  rolled_back   (operator only: back on the
  #     │                │                     legacy path, and pinned there)
  #     │                │ diffs recorded, held
  #     └──► parked ─────┘                    (error: retried on a later pass)
  #
  # "Migrated" holds bindings AND legacy rows; behaviour is unchanged until
  # "finalized", and finalization requires a decision-level parity proof. The
  # operator rollback fires from "migrated" or "finalized" alike - both are
  # already live on the ledger - never from "parked" or "rolled_back" itself.

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
  Scenario: Cloud rollout processes only enrolled organizations
    Given the installation is cloud and an operator enrolled "acme" for migration
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
  Scenario: An operator rolls a migrated organization back to its legacy path
    Given "acme" was migrated but held on a parity disagreement, so its
      grant writes already ride the ledger
    When an operator records "acme" as rolled back
    Then "acme"'s grant writes return to the imperative path with no deploy
    And later passes leave "acme" alone instead of re-migrating it

  @unit
  Scenario: A pass already in flight cannot overwrite an operator's rollback
    Given a pass read "acme" as migrated and is still working through it
    When an operator records "acme" as rolled back before the pass concludes
    Then the pass's conclusion is discarded rather than written over the rollback
    And "acme" stays rolled back on its legacy path
    And a pass that errors on "acme" cannot park over the rollback either

  @unit
  Scenario: The pass keeps its lease while one large organization migrates
    Given migrating "acme" takes longer than a single lease term
    When the pass is working through "acme"
    Then the lease is renewed for as long as the pass runs
    And a lease lost to another process stops this pass at the next
      organization

  # ============================================================================
  # Enrollment and self-hosted release pacing
  # ============================================================================
  # The rollout's pacing lives in the product, not the environment. Cloud is
  # paced per organization AND per migration by enrollment rows operators
  # write on the ops migrations page - one row per (organization, migration),
  # each read fresh on every pass. An organization not enrolled for a
  # migration is simply not processed by it: no state is recorded, so "not
  # enrolled yet" and "not started" are the same pending state.
  # Self-hosted has no enrollment at all: every organization migrates
  # automatically, but only through the migrations each release declares
  # ready for self-hosting - a migration still soaking on cloud ships inert
  # and engages when a later release declares it. The old environment
  # variables (including the self-hosted "none" opt-out) are retired; the
  # self-hosted levers are the release itself and the operator rollback.

  @unit
  Scenario: Enrolling an organization takes effect on the next pass
    Given the installation is cloud and "acme" was enrolled after the last pass ended
    When the next pass runs
    Then "acme" is processed without any restart or deploy
    And withdrawing "acme" stops the pass after that the same way

  @unit
  Scenario: Each migration is enrolled separately and paces independently
    Given "acme" is enrolled for the team-user backfill and the grants import
      but not for the cutover
    When a pass runs over "acme"
    Then the backfill and the genesis import proceed for "acme"
    And the cutover leaves "acme" untouched with no state recorded

  @unit
  Scenario: An organization enrolled only for a later migration waits on its prerequisites
    Given "acme" is enrolled for the cutover but not for the preparation migrations
    When a pass runs over "acme"
    Then the cutover holds "acme" as waiting on its unfinished prerequisites
    And nothing flips for "acme"

  @unit
  Scenario: Enrollment alone decides which organizations migrate
    Given a deployment still carries the retired cohort configuration
    When a migration pass runs
    Then the retired configuration changes nothing about which organizations migrate
    And the pass logs a warning pointing at enrollment on the ops page

  @unit
  Scenario: Enrolling an organization twice is refused
    Given "acme" is already enrolled for the team-user backfill
    When an operator enrolls "acme" for the team-user backfill again
    Then the enrollment is refused with error code "migration_enrollment_already_exists"
    And the standing enrollment is unchanged

  @unit
  Scenario: Withdrawing an organization that is not enrolled is refused
    Given "globex" is not enrolled for the cutover
    When an operator withdraws "globex" from the cutover
    Then the withdrawal is refused with error code "migration_enrollment_not_found"

  @unit
  Scenario: Enrolling an organization that does not exist is refused
    When an operator enrolls an organization id nothing matches
    Then the enrollment is refused with error code "organization_not_found"
    And no enrollment is written

  @unit
  Scenario: Enrolling for a migration that does not exist is refused
    When an operator enrolls "acme" for a migration name nothing matches
    Then the enrollment is refused with error code "migration_unknown"
    And no enrollment is written

  @unit
  Scenario: Enrollment does not apply to self-hosted installations
    Given the installation is self-hosted
    When an operator tries to enroll or withdraw an organization
    Then the action is refused with error code "migration_enrollment_cloud_only"
    And the ops page explains that released migrations run automatically instead

  # ----------------------------------------------------------------------------
  # Cohort enrollment - sampling the long tail without touching the big fish
  # ----------------------------------------------------------------------------
  # One organization at a time paces a rollout of ten; it does not pace a
  # rollout of seven thousand. A cohort enrolls a sample in one action - and
  # the organizations it must never sweep up are the ones the platform
  # already knows by data, not by a list an operator maintains: an enterprise
  # plan on the subscription, or a private ClickHouse route in the
  # environment. Neither signal names an id in code.

  @unit
  Scenario: An operator enrolls a sampled cohort in one action
    Given the installation is cloud with organizations not yet enrolled for the grants import
    When an operator enrolls a cohort of 50 for the grants import
    Then 50 eligible organizations are enrolled in one action
    And the result names every organization it picked, so the action is auditable

  @unit
  Scenario: A cohort never includes an enterprise organization
    Given "bigcorp" holds an active or pending enterprise subscription
    And "isolated-inc" has a dedicated data plane
    When an operator enrolls a cohort for the grants import
    Then neither "bigcorp" nor "isolated-inc" is in the cohort
    And the operator maintained no list to exclude them

  @unit
  Scenario: A cohort samples only organizations not already enrolled
    Given "acme" is already enrolled for the grants import
    When an operator enrolls a cohort for the grants import
    Then "acme" is not picked again
    And the cohort is drawn entirely from organizations with no enrollment row

  @unit
  Scenario: A cohort larger than the eligible pool enrolls the whole pool
    Given fewer eligible organizations remain than the requested cohort size
    When an operator enrolls the cohort
    Then every remaining eligible organization is enrolled
    And the result says how many were enrolled rather than erroring

  @unit
  Scenario: A cutover cohort takes the typed confirmation
    Given the cutover migration requires operator confirmation
    When an operator enrolls a cohort for the cutover without typing the confirmation
    Then the cohort is refused the same way a single cutover enrollment is

  @unit
  Scenario: Cohort enrollment does not apply to self-hosted installations
    Given the installation is self-hosted
    When an operator enrolls a cohort
    Then the action is refused with error code "migration_enrollment_cloud_only"

  @unit
  Scenario: A migration not yet released for self-hosting never runs there
    Given the installation is self-hosted
    And a migration is not yet released for self-hosted installations
    When a migration pass runs
    Then the released migrations process every organization
    And the unreleased migration is never attempted, so no state is recorded for it

  @unit
  Scenario: A release that turns a migration on for self-hosting makes it run on the next pass
    Given the installation is self-hosted
    And a new release declares the migration released for self-hosted installations
    When the next migration pass runs
    Then the migration processes every organization automatically

  @unit
  Scenario: Cloud rollout is unaffected by the self-hosted release declaration
    Given the installation is cloud
    When a migration pass runs for an enrolled organization
    Then every registered migration runs for it, whatever its self-hosted declaration says

  @unit
  Scenario: Self-hosted installations run the preparation work but not the cutover yet
    Given a self-hosted installation on this release
    When the workers boot and a pass runs
    Then the team-user backfill and the genesis import run automatically
    And the cutover waits for a later release, its organizations reading as a normal waiting state rather than needing attention

  # ============================================================================
  # The ops migrations page
  # ============================================================================
  # The page presents the migrations as the ordered pipeline they are, in the
  # operator's language: each step carries a human title and a description of
  # what it does for the organization, with the stable internal name demoted
  # to a detail. The stored name never changes - renaming it would orphan
  # every recorded state row - so the human title is presentation over it.

  @unit
  Scenario: Each migration presents a title and a description, in running order
    When an operator opens the migrations page
    Then each migration lists with its human title and a description of what it does
    And the migrations appear in the order they run per organization
    And the stable internal name is shown as a secondary detail

  @unit
  Scenario: The page shows how many organizations each migration could still enroll
    Given three organizations exist and one is enrolled for the team-user backfill
    When an operator opens the migrations page
    Then the team-user backfill shows one organization enrolled and two not enrolled
    And the gauge counts enrollment only, never readiness to run

  @unit
  Scenario: An operator finds an organization by name to act on it
    Given an organization named "Acme Corporation" exists
    When an operator searches for "acme"
    Then the search lists "Acme Corporation" with its organization id
    And enrollment, targeted runs and rollbacks accept the organization picked from the search

  @unit
  Scenario: An operator runs one migration for one organization now
    Given "acme" is enrolled for the team-user backfill
    When an operator runs the team-user backfill for "acme" now
    Then only "acme" is processed, and only by the team-user backfill
    And the operator is told the status the organization ended the run in

  @integration
  Scenario: A targeted cutover run takes the typed confirmation
    Given "acme" is enrolled for the cutover
    When an operator runs the cutover for "acme" now without confirming
    Then the run is refused before any work starts
    And the same run carrying the typed confirmation proceeds

  @unit
  Scenario: A targeted run that only waited says so, rather than reporting a held organization
    Given "acme" is enrolled for the cutover but its prerequisites have not finalized
    When an operator runs the cutover for "acme" now
    Then the operator is told the cutover is waiting on the earlier steps
    And the operator is not told a parity proof found disagreements

  @unit
  Scenario: A targeted run for an organization that is not enrolled is refused
    Given the installation is cloud and "globex" is not enrolled for the grants import
    When an operator runs the grants import for "globex" now
    Then the run is refused with error code "migration_run_requires_enrollment"
    And no state is recorded for "globex"

  @unit
  Scenario: A targeted run while a pass is already running is refused
    Given a migration pass holds the fleet-wide lease
    When an operator runs a migration for one organization now
    Then the run is refused with error code "migration_pass_already_running"
    And the operator can simply retry once the pass concludes

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
      without the legacy rows, at the team and project scopes the promoted
      bindings replace
    And "acme" is finalized only when the two runs agree on every decision

  @unit
  Scenario: The legacy org-level union keeps working through finalization
    Given "sam"'s legacy team row grants an organization-level permission that
      no binding grants
    When the migration verifies "acme"
    Then "acme" is finalized on the team and project scopes its bindings replace
    And "sam" keeps that organization-level permission, because the union
      stays live until the contract change deletes the rows themselves

  @unit
  Scenario: A proof interrupted by shutdown parks the organization
    Given the workers shut down while "acme"'s parity proof is part-way through
    When the proof is interrupted
    Then "acme" is parked rather than finalized on an unfinished proof
    And the next pass verifies "acme" from the start

  @unit
  Scenario: The legacy team rows keep answering until contract deletes them
    Given "acme" may be pending, migrated, parked, or finalized
    When a permission check runs for a member of "acme"
    Then the legacy fallback participates exactly as it does today
    And it retires only when the contract change deletes the rows themselves

  @unit
  Scenario: A held organization heals itself on a later pass
    Given "acme" was held because a swept scope still disagreed
    When a later migration pass verifies "acme" and the disagreement is gone
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

  @unit
  Scenario: A backdated witness cannot rewrite a migration's status backwards
    Given the runner has already witnessed "acme" reach a later migration
      status
    When an older, redelivered witness for that migration arrives
    Then the older witness is ignored
    And the later status still holds

  @integration
  Scenario: A clean parity proof and the cutover are recorded as facts
    Given the migration verified "acme" with no disagreement
    When "acme" is cut over
    Then the ledger records the parity proof with its empty diff list
    And the ledger records the cutover with its actor
    And the projection the permission fork reads marks "acme" as on the engine

  @integration
  Scenario: Rolling back a cutover takes effect without a deploy, even with the queue stopped
    Given "acme" was cut over and is served by the engine
    And the queue infrastructure is stopped
    When an operator rolls "acme" back
    Then the rollback is recorded and applied before the call returns
    And permission checks in "acme" consult the legacy path within the gate's cache window

  @unit
  Scenario: An operator retries a rollback whose effect did not fully apply
    Given a finalized organization whose rollback effect failed partway
    When the operator rolls it back again
    Then the enforcement flip is re-applied and the ledger records one rollback

  @unit
  Scenario: A rollback fact lands however the pods' clocks disagree
    Given "acme" was cut over with the completion stamped by a worker whose
      clock runs ahead of the pod serving the operator
    When an operator rolls "acme" back
    Then the rollback fact is stamped after the completion it undoes
    And a replay of the stream still ends with "acme" off the engine

  @unit
  Scenario: A migration the cutover stands on cannot be rolled back from under it
    Given "acme" was cut over and is served by the engine
    When an operator tries to roll back its genesis import or its team backfill
    Then the rollback is refused, naming the cutover as what stands on it
    And nothing about "acme"'s state changes
    And rolling the cutover back first re-opens the path

  @unit
  Scenario: Rolling back a cutover that never started is refused
    Given "acme" is only waiting to cut over and is not served by the engine
    When an operator tries to roll its cutover back
    Then the rollback is refused because there is nothing to roll back
    And "acme" is not pinned, so it still cuts over once its wait ends

  @integration
  Scenario: Cutover imports the legacy facts that only exist outside bindings
    Given "acme" has a member whose only admin fact is a legacy organization ADMIN row
    And "acme" has a share link
    When "acme" is cut over
    Then the legacy admin holds an organization-scoped admin grant
    And the share link is a resource-scope grant with its token and expiry intact
    And every imported grant carries the business time of the fact it came from

  @unit
  Scenario: Platform operator access is never a ledger fact
    Given the admin list in the environment is the live authority for operator access
    When an organization is cut over
    Then every fact the cutover states belongs to that organization's own aggregate
    And no fact is stated for any tenant that is not an organization

  @unit
  Scenario: A share grant no legacy link accounts for holds the cutover
    Given "acme" holds a resource grant with no share link behind it
    When the cutover proves the resource import
    Then "acme" is held with that grant reported as extra
    And "acme" is not cut over

  @unit
  Scenario: A view spent while an organization is held is handed over on the next pass
    Given "acme"'s share budgets were seeded on an earlier pass
    And a visitor spent another view on the legacy path since
    When a later pass re-runs the cutover for "acme"
    Then the usage row is raised to carry the newly spent view
    And a view already handed over is never walked back
    And the import proof comes back clean

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
  Scenario: The convergence wait grows with the size of the import
    Given "acme"'s genesis import states more facts than the base wait could fold
    When the import waits for the projection to land its facts
    Then the wait's deadline scales with the number of facts it is waiting on
    And an organization within the ceiling's budget is never parked for being large

  @unit
  Scenario: The convergence wait's budget has a ceiling
    Given an organization whose import is larger than the ceiling's budget
    When the import waits for the projection
    Then the wait stops growing at the ceiling, so one organization cannot hold the pass indefinitely
    And past it the organization parks and finishes on a later pass, as every organization did before

  @unit
  Scenario: Running the genesis import twice states the same facts
    Given the genesis import already ran for "acme"
    When it runs again
    Then the same fact ids are emitted, so the import converges rather than
      duplicating

  @unit
  Scenario: A shifted chunk never reuses a previous pass's idempotency key
    Given "acme"'s legacy rows changed which one occupies a chunk's position
      since the last pass
    When the genesis import runs again for "acme"
    Then that chunk's fact carries a different idempotency key than the
      earlier pass did
    And the newly positioned row is not deduped away as if it were the old
      one

  @unit
  Scenario: The row that replaced a deleted one reaches the fold
    Given a legacy row was deleted and a new row now occupies its chunk
      position
    When the genesis import runs again for "acme"
    Then the replacement row's grant reaches the fold

  @unit
  Scenario: A grant revoked on the legacy side does not survive a re-import
    Given a legacy binding row the genesis import already landed as a grant
    When that row is deleted on the legacy side and the import runs again
    Then the grant's head fact is cleared
    And the ledger is asked to revoke the grant, not merely stop re-attaching
      it

  @unit
  Scenario: A custom role deleted on the legacy side does not survive a re-import
    Given a custom role row the genesis import already landed as a role fact
    When that role is deleted on the legacy side and the import runs again
    Then the role's head fact is cleared
    And the ledger is asked to delete the role, not merely stop redefining it

  @unit
  Scenario: An imported grant updates the row it adopted and never authors a new one
    Given a legacy binding row adopted by the genesis import
    When the fold stores that grant
    Then the existing compat row is updated in place
    And no second compat row is created for it

  @unit
  Scenario: A role change clears the pre-migration legacy role
    Given a legacy binding row adopted by the genesis import, carrying its
      pre-migration role
    When the grant's role is reassigned
    Then the pre-migration role is dropped rather than carried onto the new
      role

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

  @unit
  Scenario: Revoking an orphaned group binding runs before the membership edit commits
    Given a group edit that both revokes a binding left with no member and
      removes a member
    When the edit is applied
    Then the binding revocation runs before the membership edit commits

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
  # Share-link revocation survives every crash window (decisions 7 and 22)
  # ============================================================================
  # Revocation is the one write whose failure mode is MORE access: a revoke
  # that deletes a compat row without recording the fact is undone by the
  # fold's next run, and the link the customer revoked resolves again. These
  # scenarios pin what keeps every crash window at less-or-equal access:
  # a revoke never depends on a projection that may lag or a cached answer
  # that may be stale or failed, and a consumed view commits together with
  # its compat mirror or not at all.

  @unit
  Scenario: Revoking a link whose grant row has not landed still records the fact
    Given a cut-over organization's share link minted through the ledger
    And the fold has written the link's compat row but not its grant row
    When the link is revoked
    Then the revocation fact is recorded keyed by the link's own id
    And the link stops resolving before the call returns
    And the fold's re-run cannot bring the revoked link back

  @unit
  Scenario: A resource-wide revoke also names the links only the compat head can see
    Given a cut-over organization with a link whose grant row has not landed
    When every link for that resource is revoked
    Then the revocation facts include that link's own id
    And the remaining compat rows are swept

  @unit
  Scenario: A revocation never appends a fact for a link outside the caller's project
    Given a revoke names an id that no head anchors to the caller's project
    When the revoke runs
    Then no revocation fact is recorded and no row is deleted

  @unit
  Scenario: Revocation routing never trusts a cached gate answer
    Given an organization was cut over after this process cached it as legacy
    When one of its share links is revoked
    Then the routing takes a fresh answer rather than the cached one
    And the revoke is written through the ledger, not the legacy-only branch

  @unit
  Scenario: A failed cutover read routes a revocation toward deleting both heads
    Given the cutover projection read fails
    When a share link is revoked
    Then the revoke is written through the ledger and the compat row is swept
    And no failure window leaves the customer with more access than before

  @unit
  Scenario: A consumed view and its compat mirror commit together
    Given a cut-over organization's share link with views remaining
    When a visitor's view is consumed
    Then the usage count and its compat mirror are written in one transaction
    And a crash between the two writes can no longer refund a view

  @unit
  Scenario: A view that loses the first-view race retries in a fresh transaction
    Given two visitors race to consume a link's first view
    When the loser's guarded create collides
    Then the loser re-runs the cap condition exactly once, in its own transaction
    And the view budget is never overcounted

  @unit
  Scenario: The resource-tier collect never pins an organization's head beyond one read
    Given the process-lifetime collector serves share-link reads
    When a share-link read is collected
    Then nothing from that read outlives answering it
    And a rollback is honoured by the organization's next read without a restart

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

  @unit
  Scenario: A key born during a parked genesis import still mints once the organization migrates
    Given an organization that was parked for weeks before its genesis import
      finally migrated
    When a legacy service key from before the parked period authenticates
    Then the minted grant's business time is the moment the organization
      migrated, not the moment it was first parked

  # One writer, one refusal: for an organization on ledger writes, a grant
  # write with no event-sourcing stack refuses rather than half-happening.
  @unit
  Scenario: A migrated organization's grant write refuses while the ledger is unavailable
    Given an organization whose grant writes ride the ledger
    And the event-sourcing stack is unavailable to the process
    When a grant write is attempted
    Then the write is refused with error code "authz_ledger_unavailable"
    And a retry after the stack returns is not poisoned by the refusal
