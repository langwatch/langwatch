# The upgrade reader: slice U1 of dev/docs/plans/upgrade-ui-2026-10-06.md (sections 4, 8 and 12),
# a row of dev/docs/plans/migrations-blitz-2026-10-06.md section 5.2.
#
# One read model over the ledger tables answers the Upgrades page and `upgrade status`: the
# installation state, the releases, the steps, the runs. It reads only the ledger tables (the poll
# path of an open operator tab), never per-tenant state. An older release's page reads rows a newer
# runner wrote, so an unknown step kind or status is passed through raw and never thrown on.
#
# The installation state is the first match of: Unsupported, Needs attention, Upgrading, Never
# upgraded, Behind, Rolled back, Finishing in background, Up to date (round 17, U1-a: an empty
# ledger is its own state, not Behind with a reason).

Feature: The upgrade reader answers the installation state and the ledger's rows
  As an operator of a self-hosted installation
  I want one place that says whether my installation is current and what remains
  So that the Upgrades page and `upgrade status` agree and never guess

  @unit
  Scenario: An installation whose image and ledger agree is up to date
    Given the ledger records release 3.21.0 with every step done
    And the image is release 3.21.0
    When the installation state is read
    Then the state is "up-to-date"

  @unit
  Scenario: Background steps still pending read as finishing in background
    Given the ledger records release 3.21.0 and one background step is pending
    And the image is release 3.21.0
    When the installation state is read
    Then the state is "finishing-in-background"

  @unit
  Scenario: A run holding the lease reads as upgrading
    Given the ledger records release 3.20.1 and a lease that has not expired
    And the image is release 3.21.0
    When the installation state is read
    Then the state is "upgrading"

  @unit
  Scenario: An image newer than the ledger reads as behind
    Given the ledger records release 3.20.1 with every step done
    And the image is release 3.21.0
    When the installation state is read
    Then the state is "behind"
    And the reason is "image-newer"

  @unit
  Scenario: An image declaring a blocking step the ledger lacks reads as behind
    Given the ledger records the same release as the image
    And the image declares a blocking step the ledger does not hold as done
    When the installation state is read
    Then the state is "behind"
    And the reason is "blocking-steps-pending"

  @unit
  Scenario: An image older than the ledger and at or above the floor reads as rolled back
    Given the ledger records release 3.22.0 and the floor is 3.20.1
    And the image is release 3.21.0
    When the installation state is read
    Then the state is "rolled-back"

  @unit
  Scenario: An installed release below the floor reads as unsupported
    Given the ledger records release 3.16.0 and the floor is 3.20.1
    When the installation state is read
    Then the state is "unsupported"
    And the reason is "installed-below-floor"

  @unit
  Scenario: An image below the floor the ledger recorded reads as unsupported
    Given a run recorded the floor 3.20.1
    And the image is release 3.19.0
    When the installation state is read
    Then the state is "unsupported"
    And the reason is "image-below-ledger-floor"

  @unit
  Scenario: A failed step reads as needs attention before anything softer
    Given the ledger records one failed step, a pending background step and an older image
    When the installation state is read
    Then the state is "needs-attention"

  @unit
  Scenario: A failed target reads as needs attention
    Given every step is done but one ClickHouse target is failed
    When the installation state is read
    Then the state is "needs-attention"
    And the reason is "failed-target"

  @unit
  Scenario: Unsupported wins over every other state
    Given the ledger records release 3.16.0 below the floor with a failed step and a live lease
    When the installation state is read
    Then the state is "unsupported"

  @unit
  Scenario: Releases are compared by version and an unversioned build is never ordered
    Given the releases 3.9.0, 3.10.0, 3.10.0-rc.1 and the build git-1a2b3c4
    When they are compared
    Then 3.10.0 is newer than 3.9.0 and than 3.10.0-rc.1
    And git-1a2b3c4 is neither newer nor older than any version

  @integration
  Scenario: An empty ledger reads as no upgrade recorded yet
    Given a database whose ledger tables hold no rows
    When the status is read
    Then the state is "never-upgraded" with the reason "no-upgrade-recorded"
    And the summary reads "No upgrade recorded yet"

  @integration
  Scenario: A database without the ledger tables reads as no upgrade recorded yet
    Given a database where the ledger tables do not exist
    When the status is read
    Then the state is "never-upgraded" with the reason "no-upgrade-recorded"

  @integration
  Scenario: The status carries the installed release, the origin and the last run
    Given a seed run and a later upgrade run that both succeeded
    When the status is read
    Then the installed release is the newest succeeded run's release
    And the origin is "recorded"
    And the last run is the newest run

  @integration
  Scenario: A release known only from a seed is marked inferred
    Given only a seed run recorded a release
    When the status is read
    Then the origin is "inferred"

  @integration
  Scenario: An unknown step status is shown raw
    Given a step row whose status is "quarantined"
    When the steps are listed and the status is read
    Then the step is listed with the status "quarantined" and the label "quarantined"
    And nothing is thrown

  @integration
  Scenario: An unknown step kind and mode are passed through
    Given a step row whose kind is "reindex" and whose mode is "deferred"
    When the steps are listed
    Then the step is listed with the kind "reindex" and the mode "deferred"

  @integration
  Scenario: Steps are listed with the filters of release, mode and status
    Given steps across two releases, three modes and several statuses
    When the steps are listed with a release, a mode and a status filter in turn
    Then each filter returns only the matching steps

  @integration
  Scenario: A step the image declares but the ledger lacks is listed as waiting and not recorded
    Given the image declares a step the ledger has no row for
    When the steps are listed
    Then the step is listed with the status "pending" and recorded false

  @integration
  Scenario: Releases are listed newest first with their step counts
    Given steps recorded for three releases and an image release not yet recorded
    When the releases are listed
    Then the releases are ordered newest first with a count per status
    And the image release is marked as the image

  @unit
  Scenario: An unreleased image marks the Unreleased row as this image
    Given an image no release names, declaring a step in no manifest and a step of release 3.20.1
    When the releases are listed
    Then the Unreleased row is marked as the image and lists the unlisted step
    And release 3.20.1 is not marked as the image

  @integration
  Scenario: A step lists no targets before the target table exists
    Given a database whose ledger has no target table
    When a step is read
    Then its targets are empty

  @integration
  Scenario: A step lists its targets once the target table exists
    Given a step with a done target and a failed target
    When the step is read
    Then both targets are listed with their status and version

  @integration
  Scenario: An unexpired lease reads as upgrading and names its holder
    Given a lease row that expires in the future
    When the status is read
    Then the state is "upgrading" and the lease names the owner, image and host

  @integration
  Scenario: An expired lease does not read as upgrading
    Given a lease row that expired a minute ago
    When the status is read
    Then the state is not "upgrading"

  @integration
  Scenario: Runs are listed newest first in pages
    Given five runs
    When the runs are listed two at a time following the cursor
    Then the pages hold two, two and one runs, newest first, and the last cursor is null

  @integration
  Scenario: A run is read with its plan, its report and the steps it recorded
    Given a run that recorded two steps
    When the run is read
    Then it carries the plan, the report and both steps

  @integration
  Scenario: A run's phases are read from its report
    Given a run whose report holds a preflight, a Postgres schema and a reconcile phase
    When the run is read
    Then it carries the three phases in the order the runner wrote them

  @unit
  Scenario: A run recorded before phases existed reads with no phases
    Given a run whose report holds no phases
    When its phases are parsed
    Then they read as none

  @unit
  Scenario: A phase with a name or outcome the reader does not know is passed through raw
    Given a run whose report holds a phase named "drain" with the outcome "skipped"
    When its phases are parsed
    Then the phase reads with that name and outcome as written
    And a phase entry that is not an object is dropped

  @integration
  Scenario: Reading a step or a run that does not exist is refused by code
    When a step id and a run id the ledger does not hold are read
    Then each is refused with the code "upgrade_not_found"

  @integration
  Scenario: A malformed cursor is refused by code
    When the runs are listed with a cursor that is not one the reader issued
    Then it is refused with the code "upgrade_invalid_cursor"

  @integration
  Scenario: Every read is answered from a schema holding only the ledger tables
    Given a schema holding only the ledger tables
    When the status, releases, steps and runs are read
    Then every read answers

  @unit
  Scenario: The status prints as plain text for the command line
    Given a status with an installed release, a failed step and a lease
    When it is formatted
    Then the text names the state, the releases, the failed step and the lease holder

  @unit
  Scenario: An empty ledger prints as no upgrade recorded yet
    Given the status of an empty ledger
    When it is formatted
    Then the text contains "No upgrade recorded yet"

  @unit
  Scenario: A step status the reader does not know prints raw in the text
    Given a status whose counts include "quarantined"
    When it is formatted
    Then the text contains "quarantined"

  # Preflight (upgrade-ui plan 6.1.3, U6): rows in the checkup's verdict shape, read from the status.
  @unit
  Scenario: The preflight refuses an installation below the floor, a failed step and a live lease, naming each fix
    Given a status below the floor, with a failed step and a lease held
    When the preflight is read
    Then the floor, failed-step and lease rows are refused, each with a fix

  @unit
  Scenario: The preflight of a current installation is verified except the backup, which is always unchecked
    Given the status of an up-to-date installation
    When the preflight is read
    Then every row is verified but the backup row, which is unchecked and names the upgrade docs
