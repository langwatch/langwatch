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
  Scenario: A release's steps are grouped by mode
    Given a release with a blocking, a background and an operator step
    When an operator opens that release
    Then the steps are listed under Blocking, Background and Operator in that order

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

  @unimplemented
  Scenario: A run's phases are listed per release in the order they ran
    Given a run from 3.21.0 to 3.23.0 that passed through two releases
    When an operator opens the run
    Then the preflight is listed first
    And each release's Postgres schema, ClickHouse schema and blocking steps follow in order
    And the reconcile phase is listed last

  @unimplemented
  Scenario: A view-only operator reads every upgrade screen
    Given a reader holding the operator view grant and not the manage grant
    When they open each Upgrades page
    Then every page opens

  @unimplemented
  Scenario: A reader without the operator grant is refused every upgrade screen by the router
    Given a reader holding no operator grant
    When they open an Upgrades page
    Then the page is refused and names the grant "ops:view"

  @unimplemented
  Scenario: Every upgrade read asks the operator view grant at the door
    Given the six ops.upgrade queries
    When their declarations are read
    Then each asks "ops:view" at the platform scope before its handler runs

  @unimplemented
  Scenario: A non-operator calling an upgrade read is refused by the door
    Given a signed-in user who is not a platform operator
    When they call ops.upgrade.status
    Then the call is refused before the handler runs
    And the reader is never asked

  @unimplemented
  Scenario: Upgrade reads answer the reader's shapes unchanged
    Given a ledger with a release, a step and a run
    When an operator calls ops.upgrade.status, listReleases, listSteps, getStep, listRuns and getRun
    Then each answers what UpgradeReader answers for the same ledger
