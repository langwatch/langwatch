# The generic system-migrations runner: cohorts, enrollment, passes, claims,
# rollback and the operator surfaces. What any one migration does when it runs
# lives in that migration's own spec — for the authz migration,
# specs/migration/authz-grants-rollout.feature.

@migration @runner
Feature: Running system migrations across organizations
  As a LangWatch operator
  I want migrations to run organization by organization, paced while a rollout
  is happening and automatic once it is finished, claimed by one process at a
  time and reversible without a deploy
  So that a platform-wide change lands gradually, reaches every organization
  in the end including the ones created since, and any organization can be
  taken back off it the moment something looks wrong

  Background:
    Given a registered system migration
    And an organization "org_acme"

  # ═══ Passes and claims ════════════════════════════════════════════════

  @unit
  Scenario: A pass migrates several organizations at once
    Given several organizations awaiting migration
    When a pass runs
    Then more than one organization is migrated in the same pass

  @integration
  Scenario: Each organization is claimed by one process at a time
    Given two processes running a pass
    When both reach "org_acme"
    Then one migrates it and the other leaves it alone

  @unit
  Scenario: The pass keeps its claim while one large organization migrates
    Given "org_acme" takes longer to migrate than the claim's lease
    When the pass is still working on it
    Then the claim is renewed rather than expiring mid-migration

  @unit
  Scenario: An organization that fails mid-migration is parked and retried
    Given the migration throws for "org_acme"
    When the pass finishes
    Then "org_acme" is parked rather than failing the pass
    And a later pass attempts it again

  @unit
  Scenario: A finalized organization is never processed again
    Given "org_acme" is finalized
    When a later pass runs
    Then it is skipped

  # ═══ Who a pass visits at all ═════════════════════════════════════════
  # Being skipped is not free. A skip is a claim taken, a state row read per
  # migration and a claim released, and a fleet whose tenants have almost all
  # finished pays that for every one of them on every pass, on every replica,
  # before any of them may serve. A tenant that has finished EVERY migration a
  # pass would drive over it has nothing left to do ever, so the pass does not
  # enumerate it — while anything short of that is enumerated exactly as
  # before, and what then happens to it is still the runner's decision.

  @integration
  Scenario: A tenant that has finished every migration a pass drives is not visited again
    Given "org_acme" is finalized for every migration the pass drives
    When a pass runs
    Then it is not visited at all

  @integration
  Scenario: A tenant with one of a pass's migrations still to finish is visited
    Given "org_acme" is finalized for one migration and parked for another
    When a pass runs
    Then it is visited

  @integration
  Scenario: A tenant no pass has ever touched is visited
    Given "org_acme" has no record for any migration
    When a pass runs
    Then it is visited

  @integration
  Scenario: A tenant an operator rolled back is not visited again
    Given "org_acme" is rolled back for every migration the pass drives
    When a pass runs
    Then it is not visited at all

  @integration
  Scenario: An operator's pin written during a pass stands
    Given "org_acme" is migrated and a pass is about to finalize it
    When an operator pins it rolled back in the same moment
    Then the pass's write is refused
    And "org_acme" stays rolled back with the operator's report
    # The pin is the only brake the design has. The pass's write waits on the
    # pin's row lock and re-reads the status as the pin left it, rather than
    # deciding on the row as it read it before the wait.

  @unit
  Scenario: A pass with no migrations to drive visits nobody
    Given an installation that runs none of the registered migrations
    When a pass runs
    Then no tenant is enumerated

  @unit
  Scenario: A migration that declares its own tenants keeps them
    Given a migration that declares its own candidate tenants
    And another migration driven over every tenant
    When a pass runs
    Then the declaring migration is driven over the tenants it declared
    And the other is driven over the tenants with work left for it

  @unit
  Scenario: A pass may ask which tenants have work left across the whole installation
    Given the question a tenant source asks is the tenant list itself
    When the multitenancy guard reads it
    Then it is admitted rather than refusing the pass

  # ═══ Converging ═══════════════════════════════════════════════════════
  # One pass is never enough on its own: a pass cannot observe its own
  # events, so an organization it adopts reads as held and only a LATER pass
  # finalizes it. Startup therefore runs a blocking preflight of passes rather
  # than one background pass — nobody should receive traffic, have to restart
  # the app, or click "run a pass" before the counts settle.
  #
  # It stops on NO PROGRESS, never on "everything is terminal": a held
  # organization is re-proved on every pass and may legitimately never reach
  # a terminal state, so waiting for terminal would never stop.

  @unit
  Scenario: The runner drives passes until nothing advances
    When the app starts
    Then passes run one after another while each one advances an organization
    And the first pass that advances nothing ends the run
    And runtime processes start only after that run completes

  @unit
  Scenario: Preflight projection work cannot consume application traffic
    Given the preflight emits events while an existing worker is still running
    When those events and application events are queued concurrently
    Then the preflight uses the canonical queue and its aggregate locks
    And it dispatches only groups registered by that preflight
    And blocked or failed work the preflight itself caused in those groups prevents startup
    And worker-scoped durable subscribers run for the preflight events
    And schedulers, process-manager consumers, and general workers do not start

  # A group's error marker has no expiry and is cleared only by a later success
  # on that same group, so a failure ordinary traffic left before the upgrade —
  # or one an earlier, crashed preflight left — would otherwise refuse every
  # boot that followed, on every replica, forever. A group already wedged when
  # the preflight adopted it was wedged under the previous release, and
  # refusing to start fixes none of it.
  @integration
  Scenario: A group wedged before the preflight does not refuse startup
    Given a group blocked with a failure from before the preflight adopted it
    When the preflight settles its pass
    Then that group neither holds the barrier open nor prevents startup
    And it stays blocked, reported for operator triage
    But a failure produced by the preflight's own work still prevents startup
    And the refusal names the groups it refuses for, not a count of them

  # The barrier's deadline is the one refusal a booting fleet cannot answer.
  # Every replica runs this preflight BEFORE it starts consuming, so work the
  # preflight queues drains only if some other process is already serving that
  # queue. On a fleet booting together there is none, and a claim whose worker
  # a previous crash-loop killed outlives it and blocks its group's head. Each
  # boot then queues more behind that head and refuses over it, which is what
  # keeps the consumer that would drain it from ever starting. Observed on the
  # identity backfill: one group, `active: 1` with no owner alive, `pending`
  # climbing 32 → 50 across boots, every replica crash-looping.
  #
  # Work that has not drained leaves its tenant HELD, and a held tenant already
  # starts on the legacy path with its migration gate closed. Waiting for the
  # drain is how a pass finalizes that tenant sooner, never how it stays safe —
  # so giving up on the wait costs a later pass, not correctness. Work that
  # actually FAILED is a different thing and still refuses: that is a fault a
  # later pass will not clear, and it is the half of this barrier worth keeping.
  @integration
  Scenario: Work that never drains leaves its tenants held rather than refusing startup
    Given the preflight's own work has not drained when the barrier's deadline passes
    And none of that work has failed or blocked
    When the barrier gives up waiting
    Then startup continues rather than refusing
    And the groups it stopped waiting for are named for operator triage
    And their tenants stay held, to be re-proved by a later pass
    But work that failed or blocked by the deadline still prevents startup

  @unit
  Scenario: A recurring reconciliation does not loop forever
    Given a migration declares its held outcome to be recurring reconciliation
    When the app starts
    Then it is re-proved once and the run ends
    And being re-proved into the same state does not count as progress

  @unit
  Scenario: A held migration stays on the legacy path without preventing startup
    Given a migration remains held after its pass, with nothing advancing
    When the app starts
    Then it is re-proved once and the run ends
    And being re-proved into the same state does not count as progress
    And its migration gate stays closed on the legacy path

  @unit
  Scenario: One tenant's parked migration does not stop the fleet starting
    Given one tenant's migration parks on an error
    When the app starts
    Then the preflight still completes and runtime processes start
    And that tenant stays on its legacy path, served as it was before
    And the park is reported as an error against its tenant and migration

  @unit
  Scenario: Cancelling startup stops the loop between passes
    Given a run waiting between two passes
    When startup is cancelled
    Then no further pass starts
    And runtime processes do not start

  # `lease.acquire` fails safe to false on contention AND on any Redis error,
  # and a tenant that cannot be claimed does no work — so a pass shut out of
  # the whole fleet reports exactly what a converged one reports. Reading that
  # as convergence would stop this process for its whole lifetime, and if the
  # pod actually holding the claims is then evicted, nothing drives the rest.
  @unit
  Scenario: A pass shut out by another process is not convergence
    Given any organization is claimed by another process
    When the pass advances nothing
    Then the run continues rather than stopping
    But an installation with no organizations at all is converged

  # Every replica runs this preflight, so a rolling deploy has a dozen of them
  # sweeping the same tenants at once and each reads the others' leases as
  # claims. If a claim a peer holds prevented convergence, none of them could
  # ever start: each would be waiting on peers who are waiting on it. So a
  # process that has finished its OWN work starts, and leaves what it could
  # not claim to the peer already driving it — the same bargain a held or
  # parked tenant gets, and the re-drive cadence covers a peer that dies.
  #
  # Only PARTIAL contention counts. Being shut out of the whole fleet is what
  # an unreachable Redis looks like too, and a process that learned nothing
  # about any tenant has no grounds to call anything settled.
  @unit
  Scenario: A peer's claims do not keep this process from starting
    Given passes that advance nothing while a peer holds some of the fleet
    When the same shape repeats pass after pass
    Then the run ends and runtime processes start
    And it says it is starting rather than waiting on a peer

  # A pass now enumerates only the tenants with work left, so on a settled
  # fleet that is a handful and a dozen replicas booting together can hold
  # every one of them. "Shut out of everything" is therefore no longer proof
  # of a broken lease store, and the proof has to be named instead: a tenant
  # this process claimed is one Redis answered for, because a claim fails safe
  # to "held" on every error.
  @unit
  Scenario: A shut-out from the last remaining tenants settles once a claim has been granted
    Given an earlier pass claimed a tenant of its own
    When every later pass finds the few remaining tenants held by a peer
    Then the run ends and runtime processes start

  @unit
  Scenario: A process never granted a claim keeps trying rather than settling
    Given no pass has ever been granted a claim
    When every pass finds every tenant held
    Then the preflight fails rather than starting

  @unit
  Scenario: A momentary overlap with a peer is still waited out
    Given one pass that advances nothing while a peer holds part of the fleet
    When the next pass reads every tenant and still advances nothing
    Then that pass is what ends the run

  @unit
  Scenario: A loop that never converges prevents startup
    Given passes that report progress every time
    When the maximum number of passes is reached
    Then the preflight fails
    And it says how many passes it gave up after
    And runtime processes do not start

  @unit
  Scenario: A failed pass prevents startup
    Given a pass that fails outright
    When the run reaches it
    Then the preflight fails rather than retrying immediately
    And runtime processes do not start
    And the next start retries the pass

  # ═══ Re-driving after startup ═════════════════════════════════════════
  # The preflight converges once and then stops. Every stored status but
  # `finalized` and `rolled_back` is re-entrant, so a tenant that parks an
  # hour into a worker's life heals on the very next pass — except that on a
  # fleet which stays up there WAS no next pass, only the next deploy or an
  # operator clicking "run a pass". So a worker carries a cadence of its own,
  # driving the same pass the preflight and that click drive. It converges on
  # nothing and reads no progress count, so a tenant that parks again every
  # time costs one attempt per cadence and wedges nothing.

  @unit
  Scenario: A worker re-drives a parked tenant without being asked
    Given a tenant parked after startup had already finished
    When the worker's re-drive cadence comes round
    Then a pass runs and attempts that tenant again
    And a tenant that parks again is simply attempted again next time

  @unit
  Scenario: A recurring reconciliation keeps running on a long-lived worker
    Given a migration whose held outcome is recurring reconciliation
    When the worker's re-drive cadence comes round
    Then its tenants are re-proved again

  @unit
  Scenario: A fleet with nothing to re-drive does not sweep
    Given every tenant is finalized or pinned to its legacy path
    When the worker's re-drive cadence comes round
    Then the stored state is asked whether anything could still move
    And no pass runs

  @unit
  Scenario: Only a worker re-drives
    Given a process that does not run the worker stack
    When it starts
    Then it never drives a migration pass of its own

  @unit
  Scenario: A re-drive that fails does not end the cadence
    Given a pass that fails outright after startup
    When the cadence comes round again
    Then another pass is attempted

  # D04 records the configured legacy route WITHOUT treating the old domain
  # string as ownership evidence, which is what let it join the shared
  # registry: existing sign-in stays compatible, while activation, linking and
  # new-person trust still demand qualified proof. The registry is shared by
  # the prestart, ordinary, targeted and enrollment paths, so declaring it here
  # declares it for all four.
  #
  # This scenario used to say the opposite — that D04 stayed out of the
  # registry until a later change — and it went on saying it after the
  # registration landed. The test bound to it had been updated to assert the
  # registration, so the pair read green while the words asserted the reverse.
  @unit
  Scenario: The D04 connection grandfather migration is declared in the shared registry
    Given an organization has a staff-configured legacy SSO domain
    When any system migration entry point reads the registry
    Then the D04 connection grandfather migration is declared alongside the authorization engine migration
    And the legacy SSO route is recorded without being treated as proof of ownership

  # ═══ Automatic enrollment ═════════════════════════════════════════════
  # Enrollment paces a rollout while it is happening. A finished rollout has
  # the opposite problem: every organization created since must migrate too,
  # and nothing should depend on an operator remembering to enroll it. A
  # migration says which of the two it is, once, in its own declaration — so
  # a migration mid-rollout and a migration that has finished one can coexist
  # on the same installation.

  @unit
  Scenario: A migration can declare that every organization is in its cohort
    Given a cloud installation
    And a migration declared enrolled automatically
    When a pass computes its cohort
    Then an organization nobody enrolled is in it

  @unit
  Scenario: An organization nobody enrolled migrates for an automatically enrolled migration
    Given a cloud installation
    And a migration declared enrolled automatically
    And an organization created after the rollout finished
    When a pass runs
    Then that organization is migrated

  # A dedicated data plane is not a reason to leave an organization out on
  # this axis: these migrations are rooted in the ORGANIZATION, and an
  # organization-rooted append is placed on that organization's own instance
  # by the routing. Leaving them out would strand exactly those customers on
  # their legacy path forever.
  #
  # The user-rooted axis says the same thing now, and briefly did not. A user
  # tenant could not be placed at all, so that axis excluded private-dataplane
  # members rather than write somewhere wrong. It can be placed now — user
  # data lands on the shared instance, whoever the person belongs to, because
  # what those events record is how somebody signs in rather than any
  # organization's data (specs/private-dataplane/clickhouse-routing.feature).
  # So neither axis holds anyone back for having a dedicated data plane.
  @unit
  Scenario: An automatic cohort includes a private-dataplane organization
    Given a migration declared enrolled automatically
    And an organization with a dedicated data plane exists
    When a pass computes its cohort
    Then that organization is in it

  @unit
  Scenario: Enrolling an organization for an automatically enrolled migration is refused
    Given a migration declared enrolled automatically
    When an operator enrols an organization for it
    Then the action is refused
    And no enrollment row is written

  @unit
  Scenario: Withdrawing from an automatically enrolled migration is refused
    Given a migration declared enrolled automatically
    When an operator withdraws an organization from it
    Then the action is refused
    And nothing is paused

  @unit
  Scenario: A targeted run needs no enrollment for an automatically enrolled migration
    Given a migration declared enrolled automatically
    And an organization no enrollment row names
    When an operator targets it
    Then the migration runs for that organization

  @unit
  Scenario: The migrations page is told there is nothing to enroll
    Given a migration declared enrolled automatically
    When the migrations page reads that migration
    Then it is told every organization runs it
    And it is offered no enrollment count

  # ═══ Enrollment ═══════════════════════════════════════════════════════
  # What paces a migration that has not declared itself automatic.

  @unit
  Scenario: Enrollment alone decides which organizations migrate
    Given "org_acme" is enrolled and another organization is not
    When a pass runs
    Then "org_acme" is migrated and the other is left alone

  @unit
  Scenario: Cloud rollout processes only enrolled organizations
    Given a cloud installation
    When a pass runs
    Then only enrolled organizations are attempted

  @unit
  Scenario: Enrolling an organization takes effect on the next pass
    When an operator enrols "org_acme"
    Then the next pass migrates it

  @unit
  Scenario: Each migration is enrolled separately and paces independently
    Given two registered migrations
    When "org_acme" is enrolled for one of them
    Then only that migration processes it
    And the other migration's pacing is unaffected

  @unit
  Scenario: Enrolling an organization twice is refused
    Given "org_acme" is already enrolled
    When an operator enrols it again
    Then the action is refused

  @unit
  Scenario: Enrolling an organization that does not exist is refused
    When an operator enrols an organization id that matches nothing
    Then the action is refused

  @unit
  Scenario: Enrolling for a migration that does not exist is refused
    When an operator enrols "org_acme" for an unregistered migration
    Then the action is refused

  @unit
  Scenario: Withdrawing an organization that is not enrolled is refused
    Given "org_acme" is not enrolled
    When an operator withdraws it
    Then the action is refused

  # ═══ Cohorts ══════════════════════════════════════════════════════════

  @unit
  Scenario: An operator enrolls a sampled cohort in one action
    When an operator asks for a cohort of a given size
    Then that many eligible organizations are enrolled in one action

  @unit
  Scenario: A cohort samples only organizations not already enrolled
    Given some organizations are already enrolled
    When a cohort is sampled
    Then none of the already-enrolled organizations are drawn again

  @unit
  Scenario: A cohort leaves out an enterprise organization by default
    Given an enterprise organization exists
    When a cohort is sampled
    Then the enterprise organization is not drawn

  @unit
  Scenario: A cohort leaves out a private-dataplane organization by default
    Given an organization with a dedicated data plane exists
    When a cohort is sampled
    Then that organization is not drawn

  # Finishing a proven rollout means taking the held-back organizations over
  # too, and the single-organization enroll never applied either exclusion —
  # so the only thing the default was buying was an operator enrolling them
  # one id at a time.
  @unit
  Scenario: An operator can draw enterprise organizations into a cohort
    Given an enterprise organization exists
    When a cohort is sampled with enterprise organizations included
    Then the enterprise organization can be drawn

  @unit
  Scenario: An operator can draw private-dataplane organizations into a cohort
    Given an organization with a dedicated data plane exists
    When a cohort is sampled with dedicated-data-plane organizations included
    Then that organization can be drawn

  # Two switches, not one: an enterprise organization is a commercial risk and
  # a private-dataplane organization keeps its events in a ClickHouse instance
  # of its own. Lifting one must never lift the other.
  @unit
  Scenario: Including one held-back class does not include the other
    Given an enterprise organization and a dedicated-data-plane organization exist
    When a cohort is sampled with only enterprise organizations included
    Then the enterprise organization can be drawn
    And the dedicated-data-plane organization is not drawn

  @unit
  Scenario: A widened cohort says so in the audit trail
    When a cohort is sampled with a held-back class included
    Then each enrolled organization's audit row records which classes were included

  @unit
  Scenario: A later step's cohort samples only organizations enrolled for the step before it
    Given a migration with ordered steps
    When a cohort is sampled for a later step
    Then only organizations enrolled for the preceding step are drawn

  @unit
  Scenario: A cohort larger than the eligible pool enrolls the whole pool
    Given fewer eligible organizations than the requested cohort size
    When the cohort is sampled
    Then every eligible organization is enrolled
    And the action does not fail

  @integration
  Scenario: A cutover cohort takes the typed confirmation
    When an operator enrolls a cutover cohort
    Then a typed confirmation is required first

  # ═══ Self-hosted installations ════════════════════════════════════════
  # Cloud decides WHO by the migration's cohort; self-hosted decides WHETHER
  # by the migration declaring itself released for self-hosting. Two axes,
  # two declarations, and self-hosted never reads the cohort one.

  @unit
  Scenario: Enrollment does not apply to self-hosted installations
    Given a self-hosted installation
    When a pass runs
    Then organizations are processed without consulting enrollment

  @unit
  Scenario: Cohort enrollment does not apply to self-hosted installations
    Given a self-hosted installation
    When a cohort enrollment is attempted
    Then it is refused

  @integration
  Scenario: A self-hosted installation migrates every organization
    Given a self-hosted installation
    When a pass runs
    Then every organization is migrated without enrollment

  @unit
  Scenario: A migration not yet released for self-hosting never runs there
    Given a self-hosted installation
    And a migration not declared released for self-hosting
    When a pass runs
    Then that migration processes nothing

  @unit
  Scenario: A release that turns a migration on for self-hosting makes it run on the next pass
    Given a self-hosted installation
    When a release declares the migration released for self-hosting
    Then the next pass runs it

  @unit
  Scenario: Cloud rollout is unaffected by the self-hosted release declaration
    Given a cloud installation
    And a migration not declared released for self-hosting
    When a pass runs
    Then the organizations in its cohort are still processed

  @unit
  Scenario: Self-hosted installations run the preparation work but not the cutover yet
    Given a self-hosted installation
    When a pass runs
    Then the migration's preparation work runs
    And no organization is cut over

  # ═══ Rollback ═════════════════════════════════════════════════════════

  @unit
  Scenario: An operator rolls a finalized organization back to its legacy path
    Given "org_acme" is finalized
    When an operator rolls it back
    Then "org_acme" answers from its legacy path again

  @unit
  Scenario: An operator rolls a migrated organization back to its legacy path
    Given "org_acme" is migrated
    When an operator rolls it back
    Then "org_acme" answers from its legacy path again

  # The pin is the ONLY runtime lever an automatically enrolled migration has -
  # there is no enrollment to withdraw - so it has to be placeable whatever
  # state the organization is in, including states that never touched the
  # ledger. What varies is whether the migration's rollback EFFECT runs.
  @unit
  Scenario: An operator stops a rollout for an organization that keeps erroring
    Given "org_acme" parks on every pass
    When an operator rolls it back
    Then the pin is recorded and later passes leave it alone
    And no rollback effect runs, because it never cut over

  @unit
  Scenario: An operator holds an organization out of a rollout before it is reached
    Given the migration has never processed "org_acme"
    When an operator rolls it back
    Then the pin is recorded and no pass ever processes it
    And no rollback effect runs, because it never cut over

  @unit
  Scenario: Rolling back a cutover takes effect without a deploy, even with the queue stopped
    Given the queue is stopped
    When an operator rolls "org_acme" back
    Then the rollback lands immediately
    And no deploy or restart is needed

  @unit
  Scenario: A pass in flight cannot overwrite an operator's rollback
    Given an operator rolled "org_acme" back while a pass held it
    When the pass writes its outcome
    Then the rollback stands

  # ═══ Operator surfaces ════════════════════════════════════════════════

  @unit
  Scenario: Each migration presents a title and a description, in running order
    When an operator opens the migrations page
    Then every registered migration is listed with a title and a description
    And they appear in the order they run

  @unit
  Scenario: The page shows how many organizations each migration could still enroll
    When an operator opens the migrations page
    Then each migration shows how many eligible organizations remain

  @integration
  Scenario: An operator finds an organization by name to act on it
    When an operator searches for "acme"
    Then matching organizations are offered

  @integration
  Scenario: An operator runs the migration for one organization now
    When an operator targets "org_acme"
    Then it is migrated immediately

  @integration
  Scenario: A targeted cutover run takes the typed confirmation
    When an operator targets "org_acme" for a cutover
    Then a typed confirmation is required first

  @unit
  Scenario: A targeted run for an organization that is not enrolled is refused
    Given "org_acme" is not enrolled
    When an operator targets it
    Then the action is refused

  @unit
  Scenario: A targeted run while a pass is already running is refused
    Given a pass is already running
    When an operator targets "org_acme"
    Then the action is refused

  @unit
  Scenario: One contended member does not discard a user-rooted run's outcome
    Given a user-rooted migration whose tenants are "org_acme"'s members
    And one member is claimed by another pass while the rest finalize
    When an operator targets "org_acme"
    Then the run reports the organization rather than refusing outright
    And the contended member keeps the organization on the operator's list

  @unit
  Scenario: A targeted run that only waited says so, rather than reporting a held organization
    Given a targeted run that spent its time waiting on a claim
    When the run reports
    Then it says it waited
    And it does not report "org_acme" as held
