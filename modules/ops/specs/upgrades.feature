Feature: Ops shows an installation's release upgrades, read-only
  The Upgrades pages under Ops read the upgrade ledger through UpgradeReader and
  show where the installation stands: the installed and image releases, each
  release's steps and each run's phases. Nothing here runs a step.
  Plan: dev/docs/plans/upgrade-ui-2026-10-06.md sections 4, 7 (W1 to W4) and 9.
  Layout and names: dev/docs/adr/173-upgrades-run-on-deploy.md section 7 (UPGRADE-UI-2). The
  page has the tabs Overview, Runs, Steps and Organizations, plus Dataplanes when targets exist.
  No screen says "unreleased", offers a back button or hints at a command: the worker upgrades.

  @unit
  Scenario: A development build reads as the release it contains and its short commit
    Given a build that is not a release, containing 3.20.1 at commit abc1234def
    When the page names the running version
    Then it reads "Development build 3.20.1+abc1234"
    And a release build reads "Running" with its release

  @unit
  Scenario: A step status the page does not know is shown as the reader gave it
    Given a step whose status is a string this release does not know
    When the page labels it
    Then it is shown as the reader labelled it, unchanged, in a neutral tone

  @integration
  Scenario: The overview names the running release and one state line
    Given an installation running release 3.23.0 that is up to date
    When an operator opens Ops, Upgrades
    Then the overview reads "Running 3.23.0"
    And its one state line reads "Up to date"

  @integration
  Scenario: An upgrade in progress reads as step n of m and names no command
    Given an installation upgrading with 12 of 40 steps settled
    When an operator opens Ops, Upgrades
    Then the state line reads "Upgrading: step 13 of 40"
    And no command to run is shown

  @integration
  Scenario: A newer release is named with its release notes only when cloud names one
    Given cloud's usage-report reply names release 3.22.0 with its notes
    When an operator opens Ops, Upgrades
    Then the overview reads "Newer version 3.22.0 available" with a release notes link
    And with no latest release named, nothing about a newer version is shown

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
  Scenario: Failed steps read as needs attention with their count and one Retry for a manager
    Given two steps that failed
    When an operator holding ops:manage opens Ops, Upgrades
    Then the state line reads "Needs attention: 2 failed steps"
    And its Retry reopens both failed steps

  # Held organizations (Alex, 2026-10-11): a tenant step that holds or parks an organization is
  # not up to date. Self-hosted has no staff, so the line also names who resolves it.
  @unit
  Scenario: Held organizations are counted once however many steps hold them
    Given one organization held by two organization steps and another parked by one
    When the overview counts the held organizations
    Then it counts 2

  # User-rooted holds are users, not organizations (Alex, 2026-10-11, D2).
  @unit
  Scenario: Users a user-rooted step holds are not counted as held organizations
    Given one organization held by an organization step and two users held by a user step
    When the overview counts the held organizations
    Then it counts 1

  # A step whose `migrated` is its steady state (Alex, 2026-10-12): the sign-in credential repair
  # marks every user it repairs as migrated and never finalizes them, by design.
  @integration
  Scenario: A step that never finalizes by design keeps its users in step, not held
    Given the sign-in credential repair step has repaired 3 users and parked 1
    When an operator opens the Organizations tab
    Then its count reads "3 kept in step", not held
    And only the parked user is listed as needing attention
    And the overview still reads "Up to date"

  @integration
  Scenario: On cloud, held organizations turn Up to date into needs attention linking to the Organizations tab
    Given an installation that is up to date on cloud
    And an organization step that holds or parks 2 organizations
    When someone holding ops:view opens Ops, Upgrades
    Then the state line reads "Needs attention: 2 organizations held" instead of "Up to date"
    And it links to the Organizations tab
    And it does not tell the reader to contact the organization owner

  @integration
  Scenario: On self-hosted, the held organizations line also says to contact the organization owner
    Given a self-hosted installation that is up to date
    And an organization step that holds 1 organization
    When someone holding ops:view opens Ops, Upgrades
    Then the state line reads "Needs attention: 1 organization held"
    And it says to contact the organization owner

  @integration
  Scenario: A release's steps read as a summary, the unfinished ones first, the applied ones collapsed
    Given a release with hundreds of applied steps and a few still to do
    When an operator opens that release on the Steps tab
    Then it shows how many steps sit in each status and of each kind
    And the unfinished steps are listed first with their mode and what they wait on
    And the applied steps are one collapsed group that says whether each ran or was recorded done
    And an empty owner, zero attempts and a duration that never started are not shown

  @unit
  Scenario: The Steps tab groups by version, the development build first, then the newest release
    Given releases 3.18.1, 3.19.4 and 3.20.1 and steps no release names
    When an operator opens the Steps tab
    Then the steps no release names read "Development build" and are listed first
    And the releases follow newest first, each calling out how many steps are still pending
    And the oldest release, the history imported from before tracking, reads "3.18.1 and earlier"

  @unit
  Scenario: A long step error reads as a one-line summary with the full text a click away
    Given a step whose last error is a long runner message with parenthesised detail
    When an operator reads the step lists
    Then the error reads as its first clause on one line
    And the full text shows on hover and in the step drawer

  @integration
  Scenario: Organizations are a tab of the Upgrades page
    When an operator opens the Organizations tab on Ops, Upgrades
    Then the organization steps, their enrolment and per-organization actions are shown
    And the retired Ops, Migrations address opens this tab

  @integration
  Scenario: An automatic step reads every organization as enrolled
    Given a step that enrols every organization automatically, with one held organization
    When an operator opens the Organizations tab
    Then its Enrolled count reads All and no empty enrolment list is shown
    And the held organization is listed as needing attention

  # Enrolment is cloud only (ADR-173 section 7, UPGRADE-UI-2)
  @integration
  Scenario: A self-hosted installation offers no enrolment on the Organizations tab
    Given a self-hosted installation with a step that is not enrolled automatically
    When an operator holding ops:manage opens the Organizations tab
    Then the step offers run for an organization and roll back
    And it offers no enrol, enrol a cohort or withdraw
    And the Run a pass now button is shown

  @integration
  Scenario: Cloud offers enrolment beside every organization action
    Given the cloud installation with a step that is not enrolled automatically and one enrolled organization
    When an operator holding ops:manage opens the Organizations tab
    Then the step offers enrol, enrol a cohort, run for an organization and roll back
    And the enrolled organization offers withdraw

  @integration
  Scenario: The Organizations tab lists every organization's state, filtered by step and state
    Given a held organization in one step and a finalized one in another
    When an operator filters the organization list to held organizations
    Then only the held organization is listed, with its step and state

  @integration
  Scenario: The organization list names a failed read instead of showing an empty list
    Given the organization read fails
    When an operator opens the Organizations tab
    Then the organization list shows the failure and not the empty state

  @unit
  Scenario: Tenant rows are listed by step and state, one page at a time
    Given three parked tenants and one finalized in one step, and one parked in another
    When an operator asks for the first step's parked tenants two at a time
    Then the first page holds two rows and a cursor, and the next page the last row and none

  @integration
  Scenario: The unfiltered tenant list reads every step's rows within the tenant guard
    Given tenant rows in two steps on a Postgres guarded by the tenant check
    When an operator lists tenants without choosing a step
    Then both steps' rows are listed and the read is not refused

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
  Scenario: A run opens as a drawer from the Runs tab with Phases, Steps and Log
    Given a run listed on the Runs tab
    When an operator opens it
    Then a drawer opens with the tabs Phases, Steps and Log
    And the raw plan and report show only behind a "Details" toggle

  @integration
  Scenario: The seed run reads as imported history with a one-line explanation
    Given the run that imported history from before upgrade tracking
    When an operator opens it
    Then it reads "Imported history" in the list and the drawer
    And its log explains it in one line instead of showing its raw report

  @integration
  Scenario: A run's steps are listed per release in the order the reader gives them
    Given a run that passed through 3.22.0 and 3.23.0
    When an operator opens the run's Steps tab
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
    When an operator opens "Finishing in background" on the Steps tab
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

  # W7 Dataplanes (U9, ruling U6-U9-READS 2026-10-09): ops.upgrade.listTargets
  @unit
  Scenario: The dataplanes tab lists each ClickHouse target with its version, outstanding steps and last error
    Given two private ClickHouse targets, one with a failed schema step
    When an operator holding ops:view opens the Dataplanes tab
    Then each target shows its goose version and how many steps are outstanding
    And the failed target shows its last error

  # T7-F5: the shared target is a row of the table too, so an operator compares it with each private one.
  @integration
  Scenario: The dataplanes tab lists the shared ClickHouse target beside the private ones
    Given the shared ClickHouse target and a private one
    When an operator opens the Dataplanes tab
    Then the shared target is listed first with its goose version and outstanding steps
    And the private target is listed after it

  # A private organization recorded by the organization module whose route variable is missing or
  # malformed is refused by the stores (specs/private-dataplane/clickhouse-routing.feature); the
  # tab shows it so an operator sees why (Alex, 2026-10-11, T7-F2/T7-F3).
  @unit
  Scenario: The dataplanes tab says whether this deployment reaches each private target
    Given private targets whose CLICKHOUSE_URL__ variables are present, missing and malformed
    When an operator holding ops:view reads the targets
    Then each target's route reads present, missing or malformed, and the shared target present

  @integration
  Scenario: The dataplanes tab marks a private target whose route is missing or malformed
    Given a private target whose route is missing and one whose route is malformed
    When an operator opens the Dataplanes tab
    Then each of those targets is marked as refused, naming missing or malformed

  @integration
  Scenario: The dataplanes tab is hidden when no private target exists
    Given the ledger records no per-target rows, or only the shared ClickHouse target
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
  Scenario: Each organization step shows its organizations' progress on the Organizations tab
    Given an organization step with organizations finalized, held and parked
    When an operator opens the Organizations tab
    Then the step lists how many organizations are finalized, held and parked

  @integration
  Scenario: An unfinished operator step shows under Action needed and a failed one offers Retry
    Given an operator step that failed and one still pending
    When an operator holding ops:manage opens the Upgrades page
    Then both operator steps show under "Action needed" with their status
    And only the failed one offers Retry

  # Action needed on Home, never a Done button (ADR-173 section 7, UPGRADE-UI-2)
  @integration
  Scenario: Home shows Action needed for updates while an operator step is unfinished
    Given an operator step of the running version that is not finished
    When someone holding ops:view opens Home
    Then an "Action needed for updates" card shows in the slot pending join requests use
    And it links to Ops, Upgrades
    And nothing offers to mark the step done

  @integration
  Scenario: Home shows no update bar when nothing needs doing
    Given every operator step of the running version is finished, or the read is pending or failed
    When someone holding ops:view opens Home
    Then no update bar is drawn and no error flashes

  @integration
  Scenario: Project's home renders ops' action-needed card through its client token
    Given ops lends its action-needed card by its client token
    When project's home draws the slot beside the pending join requests
    Then ops' card is drawn there

  @integration
  Scenario: An uninstalled ops leaves project's home without the action-needed card
    Given no installed module lends the action-needed token
    When project's home draws the slot
    Then nothing is drawn in its place and nothing fails

  @integration
  Scenario: Home shows no update bar to someone without ops:view
    Given an operator step of the running version that is not finished
    When someone without ops:view opens Home
    Then no update bar is drawn and the steps are not read

  # The status read behind the overview (ADR-173 section 7, UPGRADE-UI-2)
  @unit
  Scenario: The status names a release build by its release
    Given an image that is release 3.21.0
    When an operator holding ops:view reads the upgrade status
    Then its version is the release 3.21.0

  @unit
  Scenario: The status names a development build by the newest release it contains and its commit
    Given an image that no release names, containing 3.20.1 and built from commit abc1234
    When an operator holding ops:view reads the upgrade status
    Then its version is a development build containing 3.20.1 at commit abc1234
    And nothing in the status reads "unreleased"

  @unit
  Scenario: The status names cloud's latest release with its notes only when it is newer
    Given cloud's last usage-report reply named release 3.22.0
    When the status of an image on 3.21.0 is read
    Then the latest release is 3.22.0 with the notes at its langwatch@v3.22.0 release page
    And an image on 3.22.0 or newer names no latest release

  @unit
  Scenario: No latest release is named when usage reporting is off
    Given cloud once named release 3.22.0 and usage reporting is now switched off
    When the status of an image on 3.21.0 is read
    Then no latest release is named

  @unit
  Scenario: The usage report keeps the latest release cloud's reply names
    Given cloud answers a usage report naming release 3.22.0
    When the install sends its daily report
    Then the latest release 3.22.0 is kept for the status to read
    And a later reply naming none forgets it

  # The console offers enrolment only on cloud; the server needs no refusal, as a self-hosted
  # pass admits every organization whatever the rows say.
  @unit
  Scenario: Enrolment acts on a self-hosted installation as it does on cloud
    Given a self-hosted installation and a step that is not enrolled automatically
    When an operator holding ops:manage enrols an organization, enrols a cohort or withdraws one
    Then each action is recorded and none is refused for being self-hosted

  # Upgrade attention notice (Alex, 2026-10-11): on self-hosted every signed-in user is told when
  # the last upgrade needs attention. Errors are a failed step, target or run; held organizations
  # stay operator-only, and cloud shows members nothing.

  @unit
  Scenario: Any signed-in member may ask whether the last upgrade needs attention
    Given the ops.upgrade.attentionNotice read
    Then the door asks no permission of a signed-in caller beyond being signed in
    And a member without ops:view gets an answer, not a refusal

  @unit
  Scenario: A self-hosted installation with a failed step shows members the upgrade notice
    Given a self-hosted installation whose upgrade status is needs attention with a failed step
    When a signed-in member reads the upgrade attention notice
    Then it answers show

  @unit
  Scenario: Held organizations alone show members no upgrade notice
    Given a self-hosted installation that is up to date with an organization held by a tenant step
    When a signed-in member reads the upgrade attention notice
    Then it answers do not show

  @unit
  Scenario: On cloud a failed step shows members no upgrade notice
    Given the cloud installation whose upgrade status is needs attention with a failed step
    When a signed-in member reads the upgrade attention notice
    Then it answers do not show

  @integration
  Scenario: Home's upgrade notice tells a member to contact their operator
    Given the upgrade attention notice answers show
    When a signed-in member without ops:view opens Home
    Then the "Action needed for updates" card reads "LangWatch's last update needs attention. Contact your LangWatch operator."
    And it offers no link

  @integration
  Scenario: An operator's upgrade notice on Home links to Ops › Upgrades
    Given the upgrade attention notice answers show
    When a signed-in operator holding ops:view opens Home
    Then one "Action needed for updates" card shows and links to /ops/upgrades

  @integration
  Scenario: The upgrade notice shows nothing while it loads
    Given the upgrade attention notice has not answered yet
    Then Home shows no card and no error
