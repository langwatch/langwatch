Feature: Ops shows an installation's release upgrades, read-only
  The Upgrades pages under Ops read the upgrade ledger through UpgradeReader and
  show where the installation stands: the installed and image releases, the LTS
  floor, each release's steps and each run's phases. Nothing here runs a step.
  Plan: dev/docs/plans/upgrade-ui-2026-10-06.md sections 4, 7 (W1 to W4) and 9.

  @unit
  Scenario: An image newer than the ledger is described as behind with the command to run
    Given the reader's reason is that the image is newer than the installed release
    When the overview asks which command fixes it
    Then it names the command "pnpm task upgrade"

  @unit
  Scenario: A step status the page does not know is shown as the reader gave it
    Given a step whose status is a string this release does not know
    When the page labels it
    Then it is shown as the reader labelled it, unchanged, in a neutral tone

  @integration
  Scenario: The overview names the installed release, the image release and the floor
    Given an installation on 3.23.0 whose image is 3.23.0 with the LTS floor 3.20.1
    When an operator opens Ops, Upgrades
    Then the page shows "Up to date"
    And it shows the installed release, the image release and the floor

  @integration
  Scenario: A release below the floor reads as unsupported and names the LTS to upgrade to first
    Given the reader says the installed release 3.18.0 is below the floor 3.20.1
    When an operator opens Ops, Upgrades
    Then the page reads "Unsupported"
    And it tells the operator to upgrade to 3.20.1 first

  @integration
  Scenario: An image newer than the ledger reads as behind and names the command
    Given an installation whose ledger is on 3.22.0 and whose image is 3.23.0
    When an operator opens Ops, Upgrades
    Then the page reads "Behind"
    And it names the command "pnpm task upgrade"

  @integration
  Scenario: The overview lists what the image deprecates, its replacement and when it is removed
    Given an image whose deprecation register names the Postgres table DataPrivacyProjectScope
    And the entry is replaced by Project and Team placement and names no removal release
    When an operator opens Ops, Upgrades
    Then a "Deprecated" section lists the table with its notice
    And it shows what replaces it and "A future release" as when it is removed

  @integration
  Scenario: The overview says when no upgrade has been recorded yet
    Given an installation whose ledger holds no release
    When an operator opens Ops, Upgrades
    Then the page says this installation has not recorded an upgrade yet

  @integration
  Scenario: A failed step names its error and its fix and is listed under needs attention
    Given a release with one step that failed with an error and a fix
    When an operator opens that release
    Then the overview lists it under "Needs attention" with its error
    And the line opens the step

  @integration
  Scenario: A release's steps read as a summary, the unfinished ones first, the applied ones collapsed
    Given a release with hundreds of applied steps and a few still to do
    When an operator opens that release
    Then it shows how many steps sit in each status and of each kind
    And the unfinished steps are listed first with their mode and what they wait on
    And the applied steps are one collapsed group that says whether each ran or was recorded done
    And an empty owner, zero attempts and a duration that never started are not shown

  @unit
  Scenario: The releases list puts unreleased first, then the newest release, and calls out what is left
    Given releases 3.19.0, 3.19.4 and 3.20.1 and unreleased steps
    When an operator opens Ops, Upgrades
    Then the unreleased steps are listed first and the releases newest first after them
    And each release calls out how many of its steps are still pending

  @unit
  Scenario: A long step error reads as a one-line summary with the full text a click away
    Given a step whose last error is a long runner message with parenthesised detail
    When an operator reads the step lists
    Then the error reads as its first clause on one line
    And the full text shows on hover and in the step drawer

  @integration
  Scenario: Tenant migrations are a tab of the Upgrades page
    When an operator opens the Tenant migrations tab on Ops, Upgrades
    Then the tenant migrations, their enrolment and per-organization actions are shown
    And the retired Ops, Migrations address opens this tab

  @integration
  Scenario: An automatic step reads every organization as enrolled
    Given a step that enrols every organization automatically, with one held organization
    When an operator opens the Tenant migrations tab on SaaS
    Then its Enrolled count reads All and no empty enrolment list is shown
    And the held organization is listed as needing attention

  @integration
  Scenario: The Tenant migrations tab lists every tenant's state, filtered by step and state
    Given a held organization in one step and a finalized one in another
    When an operator filters the tenant list to held tenants
    Then only the held organization is listed, with its step and state

  @integration
  Scenario: The tenant list names a failed read instead of showing an empty list
    Given the tenant read fails
    When an operator opens the Tenant migrations tab
    Then the tenant list shows the failure and not the empty state

  @unit
  Scenario: Tenant rows are listed by step and state, one page at a time
    Given three parked tenants and one finalized in one step, and one parked in another
    When an operator asks for the first step's parked tenants two at a time
    Then the first page holds two rows and a cursor, and the next page the last row and none

  @unit
  Scenario: A non-operator asking for the tenant list is refused by the door
    Given a signed-in user without ops:view
    When they ask for the tenant list
    Then the door refuses it

  @integration
  Scenario: The step drawer shows a step's error, fix and checkpoint, read-only
    Given a failed data step whose error names its fix and whose report holds a checkpoint
    When an operator opens the step drawer
    Then it shows the step's id, kind, mode, release and owner
    And it shows the last error and the checkpoint report
    And it offers no action

  @integration
  Scenario: A run's steps are listed per release in the order the reader gives them
    Given a run that passed through 3.22.0 and 3.23.0
    When an operator opens the run
    Then each release's steps are listed under it, 3.22.0 first, in the reader's order

  @integration
  Scenario: A run's phases are listed in the order they ran
    Given a run from 3.21.0 to 3.23.0 that passed through two releases
    When an operator opens the run
    Then the preflight is listed first
    And each release's Postgres schema and ClickHouse schema phases follow in the order they ran
    And the reconcile phase is listed last

  @integration
  Scenario: A view-only operator reads every upgrade screen
    Given a reader holding the operator view grant and not the manage grant
    When they open each Upgrades page
    Then every page opens

  @integration
  Scenario: A reader without the operator grant is refused every upgrade screen by the router
    Given a reader holding no operator grant
    When they open an Upgrades page
    Then the page is refused and names the grant "ops:view"

  @unit
  Scenario: Every upgrade read asks the operator view grant at the door
    Given the six ops.upgrade queries
    When their declarations are read
    Then each asks "ops:view" at the platform scope before its handler runs

  @unit
  Scenario: A non-operator calling an upgrade read is refused by the door
    Given a signed-in user who is not a platform operator
    When they call ops.upgrade.status
    Then the call is refused before the handler runs
    And the reader is never asked

  @unit
  Scenario: Upgrade reads answer the reader's shapes unchanged
    Given a ledger with a release, a step and a run
    When an operator calls ops.upgrade.status, listReleases, listSteps, getStep, listRuns and getRun
    Then each answers what UpgradeReader answers for the same ledger

  @unit
  Scenario: Opening a step or a run the ledger does not hold says it was not found
    Given a ledger that holds no step and no run with the id asked for
    When an operator calls ops.upgrade.getStep or ops.upgrade.getRun with that id
    Then the call answers "upgrade_not_found" rather than an empty record

  @integration
  Scenario: The upgrade pages re-read when the runner raises a read hint, without a timer
    Given an operator has a run open while it is running
    When the runner raises its read hint for that run
    Then the run view reads the run again and shows its new outcome
    And nothing re-reads it on a timer

  @integration
  Scenario: The upgrade read-hint stream relays the runner's hints and nothing else
    Given an operator holding the operator view grant has opened the upgrade read-hint stream
    When the runner publishes a hint on the platform upgrade scope
    And a malformed frame arrives on the same scope
    Then the stream relays the runner's hint once
    And it listens on no organisation's, project's or user's hints

  @integration
  Scenario: A reader without the operator view grant is refused the upgrade read-hint stream
    Given a signed-in user who is not a platform operator
    When they open the upgrade read-hint stream
    Then the stream is refused at the door
    And nothing listens on the platform upgrade scope

  # --- Background steps and their Retry (Alex, 2026-10-09, UPGRADE-CONSOLE D6) ---

  @integration
  Scenario: The background step list shows each step's state, progress and deadline
    Given a background step at 63 percent, one waiting on old writers and one failed
    When an operator opens "Finishing in background"
    Then each step shows its id, status and progress from its checkpoint report
    And each shows the release it must finish before
    And the waiting step names the processes it waits on by role, image and last seen

  @integration
  Scenario: A failed background step offers Retry to a manager
    Given a background step that failed
    When an operator holding ops:manage opens the list
    Then the failed step offers Retry

  @unit
  Scenario: Retry sets a failed step pending and the worker runs it again
    Given a background step that failed
    When an operator holding ops:manage retries it
    Then the ledger records the step as pending
    And the worker runs it again from its checkpoint

  @integration
  Scenario: A view-only operator sees the list and no Retry
    Given a background step that failed
    When an operator holding ops:view only opens the list
    Then the step shows as failed with its error
    And no Retry is offered

  @unit
  Scenario: Retry without ops:manage is refused by the door
    Given a background step that failed
    When a caller without ops:manage asks to retry it
    Then the door refuses it as forbidden and the step stays failed

  @unit
  Scenario: Retrying a step that is not failed is refused
    Given a background step that is running
    When an operator holding ops:manage asks to retry it
    Then it is refused as a conflict naming the step's status
    And the step keeps running

  @unit
  Scenario: Retrying a step the ledger does not hold says it was not found
    Given no step with the id asked for
    When an operator holding ops:manage asks to retry it
    Then it is refused as not found

  # W5 Preview (U6, ruling U6-U9-READS 2026-10-09): ops.upgrade.preview({ to })
  @unit
  Scenario: The preview lists the steps up to the release asked for, release by release
    Given an installation on 3.21.0 whose image is 3.23.0
    When an operator holding ops:view previews an upgrade to 3.22.0
    Then the preview lists release 3.22.0 with its schema, blocking, background and operator steps
    And it lists nothing from 3.23.0

  @unit
  Scenario: The preview shows the preflight rows the CLI prints
    Given a step that failed and no upgrade holding the lease
    When an operator previews an upgrade to the image's release
    Then the preflight refuses "No failed step" naming that step
    And it verifies "No upgrade in progress"
    And it leaves "Recent backup" unchecked with the fix to take a backup

  @unit
  Scenario: A target newer than the image is refused with the command that previews from that image
    Given an image on 3.23.0
    When an operator previews an upgrade to 3.24.0
    Then the preview is refused as "target_not_in_image"
    And it shows the command that runs "upgrade plan --to 3.24.0" from the 3.24.0 image

  @unit
  Scenario: An installation below the floor previews as refused with the LTS to upgrade to first
    Given an installation on 3.18.0 below the floor 3.20.1
    When an operator previews an upgrade to the image's release
    Then the preview is refused as "below_lts_floor" naming 3.20.1

  @integration
  Scenario: The preview page shows a skeleton while the preview loads
    When an operator opens Ops, Upgrades, Preview
    Then a loading skeleton shows until the preview answers

  # W7 Dataplanes (U9, ruling U6-U9-READS 2026-10-09): ops.upgrade.listTargets
  @unit
  Scenario: The dataplanes tab lists each ClickHouse target with its version, outstanding steps and last error
    Given two private ClickHouse targets, one with a failed schema step
    When an operator holding ops:view opens the Dataplanes tab
    Then each target shows its goose version and how many steps are outstanding
    And the failed target shows its last error

  @integration
  Scenario: The dataplanes tab is hidden when no private target exists
    Given the ledger records no per-target rows
    When an operator opens Ops, Upgrades
    Then no Dataplanes tab is offered

  # NO-HOLDS (Alex, 2026-10-09): the api serves every route while upgrading, so a failed schema step
  # of either store shows here with Retry; only a failed first install opens the token console.
  @unit
  Scenario: A failed Postgres or ClickHouse schema step offers Retry on the Upgrades page
    Given the worker's upgrade failed on a "prisma:" or a "clickhouse:" schema step
    When an operator holding ops:manage retries it from the Upgrades page
    Then the step is pending again for the worker's next run

  @unit
  Scenario: Every route serves while upgrading and still asks its declared permission
    Given the installation is upgrading
    When a caller without the operator grant calls an upgrade read
    Then the door refuses it before the reader is asked

  # --- Tenant and operator steps on the Upgrades page (U4, U5) ---

  @integration
  Scenario: Each tenant step shows its tenants' progress on the Upgrades page
    Given a tenant step with tenants finalized, held and parked
    When an operator opens the Upgrades page
    Then the step lists how many tenants are finalized, held and parked
    And opening the row opens the step

  @integration
  Scenario: An unfinished operator step shows its state and a failed one offers Retry to a manager
    Given an operator step that failed and one still pending
    When an operator holding ops:manage opens the Upgrades page
    Then both operator steps show their status
    And only the failed one offers Retry
