Feature: Ops runs the system migration passes and names their cohorts

  @unit
  Scenario: Organization enrollment is what puts a user in the backfill's cohort
    Given one organization enrolled in the identifier backfill and another not
    When the backfill's user cohort is read
    Then exactly the enrolled organization's members are in it
    And a user with no enrolled organization stays out

  @unit
  Scenario: The reconciliation sweep runs on every migration pass
    Given a migration pass
    When it runs
    Then abandoned newborn streams are swept alongside the migrations
    And the pass is still reported when the sweep itself fails

  @unit
  Scenario: The system-migration procedures answer under ops.upgrade and nowhere else
    Given the ten operator-only system-migration procedures
    When the ops tRPC declarations are read
    Then each of the ten sits under ops.upgrade with its original kind and platform permission
    And none of them is declared under ops

  @unit
  Scenario: A migration pass settles the declared tenant steps it drove
    Given a module declares a tenant step and the pass holds one of its tenants
    When the pass runs
    Then the step's ledger row is left pending
    And once a later pass leaves no tenant held, the row is settled

  @unit
  Scenario: Finishing an upgrade requests one system-migrations pass
    Given an upgrade run that has applied its schema and blocking steps
    When the upgrade finishes
    Then it asks a worker for one system-migrations pass and does not wait for it
    And the tenant steps that pass drives settle without waiting for the idle hourly re-drive

  @unit
  Scenario: The pass a finished upgrade requests runs ahead of any queue backlog
    Given an upgrade run that has finished while the worker's queue holds a large backlog
    When it asks a worker for one system-migrations pass
    Then the request's queue jobs run on a list of their own, ahead of the backlog
    And a request that does not settle within a minute is a warning, never a failed run
    # T6: three tenant steps never started while their request sat behind about 800k jobs.

  @unit
  Scenario: The pass a finished upgrade requests is asked under the platform tenant
    Given an upgrade run that has finished
    When it asks a worker for a system-migrations pass
    Then the request's tenant is the platform tenant, which the event store routes to the shared cluster
    And the request is never refused as a tenant with no known organisation

  @unit
  Scenario: The worker's re-drive discovers a tenant migration no pass has run
    Given an installation where no parked or held tenant exists
    And an automatic tenant migration, registered or declared, that no tenant has met yet
    When the worker's re-drive is due
    Then it runs a pass, so a fresh install or a new release's migration is picked up
    And a declared tenant step with a parked tenant is re-driven beside its finalised ones

  @unit
  Scenario: A latched fleet skips the worker's re-drive
    Given every automatic tenant migration has a finalised or rolled-back tenant
    And no tenant is parked or held
    And a cloud migration still soaking has no enrolled organization
    When the worker's re-drive is due
    Then no pass runs

  @unit
  Scenario: An organization that finished an ops-held migration does not run it again after its owner declares it
    Given organization "acme" finished the Slack connections migration under ops' legacy name
    And organization "beta" was rolled back from it and organization "gamma" is still held
    When the upgrade runs the blocking step that copies the migration's state to automation's step
    Then "acme" is finalized and "beta" rolled back under automation's step
    And "gamma" has no state under the new step, so the next pass runs it again
    And the legacy rows are left in place, and a second run copies nothing

  @unit
  Scenario: An organization enrolled in an ops-held migration stays enrolled after its owner declares it
    Given organizations "acme" and "delta" are enrolled in the Slack connections migration under ops' legacy name
    And "delta" is already enrolled under automation's step
    When the upgrade runs the blocking step that copies the migration's state to automation's step
    Then "acme" is enrolled under automation's step and "delta" keeps its one enrolment there
    And the legacy enrolments are left in place, and a second run copies nothing

  # The five identity and authz migrations ops held move to their owners' steps in one release
  # (Alex, 2026-10-12): authz:engine, identity:identifier-backfill, identity:secret-heal,
  # identity:connection-grandfather and identity:sso-domain-ownership-backfill.
  @unit
  Scenario: No tenant is migrated twice in the release that converts the identity and authz migrations
    Given organization "acme" finished the authorization engine migration under ops' legacy name
    And user "sam" finished the identifier backfill and user "ann" was rolled back from it
    And user "gil" has never been visited
    When ops copies their state to the owners' steps and a pass drives those steps
    Then "acme", "sam" and "ann" are not migrated again
    And only "gil" is migrated

  @unit
  Scenario: What an older image changed during the rollout reaches the owners' steps once it is gone
    Given the copy ran while an older image still served
    And the older image then finished "late", rolled back "pulled" and identity reopened "unproven"
    And an operator already rolled back "pinned" on the new step
    When no older image is running and identity's reopen step has run
    Then the re-copy finalizes "late", rolls back "pulled" and holds "unproven" for another pass
    And "pinned" keeps its rollback, and a second run copies nothing

  # Expand then contract (Alex, 2026-10-12): until a later release, the moved steps write both tables.
  @unit
  Scenario: A rollback to the older release after a tenant finished on the new step keeps it on its new path
    Given the older release reads only ops' older migration table
    When a pass finishes organization "acme" on the authorization engine step and users "ann" and "sam" on the identifier backfill step
    And an operator rolls "sam" back from the identifier backfill step
    Then ops' older table reads "acme" and "ann" finished under the old names, so the older release keeps them on the new path
    And it reads "sam" rolled back under the identifier backfill's old name

  @unit
  Scenario: A withdrawal made on the older page during the rollout is withdrawn on the new step by the re-copy
    Given organizations "acme" and "beta" were enrolled in the authorization engine migration and the copy carried them over
    And an operator enrolled "gamma" and withdrew "acme" on the new page, which writes both names
    And an operator withdrew "beta" on the older page during the rollout
    When the re-copy runs once no older image is running
    Then only "gamma" is enrolled in the authorization engine step, and a second run withdraws nothing

  @unit
  Scenario: The re-copy waits for older images and for identity's reopen step
    Given ops declares its migration steps
    Then the first copy is a background step that runs as soon as the new worker starts
    And the re-copy is a background step that needs old writers gone
    And it runs after the first copy and identity's reopen-unproven-accounts step

  @unit
  Scenario: A targeted run of a user step drives the organization's members
    Given the identifier backfill is a declared user step
    When an operator runs it for organization "acme" with members "sam" and "ann"
    Then both members are migrated on the step's own state, and nobody else

  @unit
  Scenario: A step still waiting for older images is not driven by a targeted run
    Given a declared step that needs old writers gone while an older image is live
    When an operator runs it for an organization
    Then the run migrates nobody

  @unit
  Scenario: An operator's rollback pins the tenant on the step's own state
    Given organization "acme" finalized the authorization engine step
    When an operator rolls "acme" back on the migrations page
    Then the step's own state reads rolled back for "acme"
    And ops records the rollback under the step's id for authz to switch its engine off

  @unit
  Scenario: Each worker process finishes an interrupted pass on its first re-drive
    Given a pass died part-way, so the stored state reads latched while some tenants have no row
    When a worker process's first re-drive wake reaches it
    Then it runs a pass without asking the stored state
    And its later re-drives ask the stored state first
    And a first pass that fails leaves the next re-drive ungated too

  @unit
  Scenario: A wake that is not due still gives a worker its first pass after boot
    Given a worker process that has completed no pass
    When a wake that is not due reaches it
    Then it runs a pass without asking the stored state
    And a later wake that is not due runs nothing

  # The unbatched tRPC link sends no body for a mutation without input, which the door refuses (WEB-9800).
  @unit
  Scenario: An operator's "Run a pass now" is accepted with an empty input
    Given an operator on Ops > Upgrades, Tenant migrations
    When they choose "Run a pass now" and the client sends an empty object
    Then the door accepts it and answers that the pass started
