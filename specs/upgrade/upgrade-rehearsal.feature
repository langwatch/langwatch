# The upgrade rehearsal (migration plan 2026-10-08, section F; lane MIG-REHEARSAL): real images over
# shared stores, old and head processes overlapping, then a report of what the first deploy does.
# The harness is dev/scripts/upgrade-rehearsal; it reproduces R01, R02, F-1 and F-2 and settles Q09
# before the fixes land, so each fix lane has a failing rehearsal to turn green.

Feature: The upgrade is rehearsed from real images before it ships
  As the maintainer merging a release that migrates stored data
  I want the real upgrade replayed from the floor and from main, with old and new processes overlapping
  So that a first-deploy failure is found on a rehearsal and not on an installation

  @unit
  Scenario: The rehearsal refuses to start and names what is missing when the host cannot run compose
    Given a host whose docker client cannot reach a daemon
    When the rehearsal starts
    Then it exits with the environment status and names the docker daemon as missing
    And it writes no report

  @unit
  Scenario: Each origin names the old image it rehearses from
    When the rehearsal is planned for the origin "3.20.1"
    Then the old image is the published "langwatch/langwatch:3.20.1"
    When the rehearsal is planned for the origin "main" with no old image
    Then the plan refuses and asks for an image or a build of origin/main
    When the rehearsal is planned for the origin "empty"
    Then there is no old image and phase 0 seeds nothing

  @unit
  Scenario: The seeded traces span the current and the previous month
    When an OTLP batch of traces is generated for a project at a given instant
    Then half of the traces start in that month and half in the month before
    And every span names the project's service and carries a trace id of 32 hex characters

  @unit
  Scenario: Old projects with no resolved privacy policy after the upgrade reproduce R01
    Given seeded projects of which some resolve no privacy policy after phase 1
    When the findings are evaluated
    Then R01 is "reproduced" and names the projects whose privacy policy does not resolve

  @unit
  Scenario: A head worker that throws ProjectNotFoundError reproduces R02
    Given head worker logs carrying ProjectNotFoundError lines
    When the findings are evaluated
    Then R02 is "reproduced" with the count of lines and of dead-lettered jobs

  @unit
  Scenario: A head roster row that declares no steps reproduces F-1
    Given a roster row of the head image whose steps are empty
    And needs-old-writers-gone steps that are not done when phase 2 ends
    When the findings are evaluated
    Then F-1 is "reproduced" and names the waiting steps

  @unit
  Scenario: A step running at SIGTERM and recorded done before the worker exited reproduces F-2
    Given a background step that was running when the head worker received SIGTERM
    And the ledger records it done with a finish time between the signal and the exit
    When the findings are evaluated
    Then F-2 is "reproduced" and names the step

  @unit
  Scenario: Jobs queued at the cut that head drains settle Q09, and jobs it leaves reproduce it
    Given jobs left queued by the old image at the cut
    When head's worker drains them with no dead letter and no refusal
    Then Q09 is "settled"
    When head's worker leaves them queued, dead-letters them or refuses them
    Then Q09 is "reproduced"

  @unit
  Scenario: A finding with no evidence collected is inconclusive, never passed
    Given a phase 2 snapshot that lacks the evidence a finding reads
    When the findings are evaluated
    Then that finding is "inconclusive" and names the evidence that was missing

  @unit
  Scenario: The plan names the phases each origin runs
    When the rehearsal is planned from an old image with no phase limit
    Then it runs phases 0 to 5, and phase 6 only when scale is asked for
    When the rehearsal is planned for the origin "empty"
    Then it runs phases 0 to 2 and the second-run check, and refuses a rollback phase

  @unit
  Scenario: A rollback that breaks only where the plan documents it passes, and any other break reproduces it
    Given the old image restarted on head's schema after head wrote DEVELOPER rows
    When its logs show only the P16 and P31 read breaks and the HTTP smoke passes
    Then ROLLBACK is "not-reproduced"
    When its logs name any other missing column or relation, or the smoke fails
    Then ROLLBACK is "reproduced"

  @unit
  Scenario: A re-upgrade after a rollback settles every step and names the steps that re-ran
    Given the ledger before the rollback and after the re-upgrade settled
    When the findings are evaluated
    Then REUPGRADE names each step whose attempt or finish moved, for a reviewer to judge by kind
    And it is "reproduced" when the upgrade failed, a step is unsettled or the rollback's queued jobs remain

  @unit
  Scenario: Losing the runner lease stops the upgrade and a re-run resumes it
    Given the runner lease taken from an upgrade while it ran
    Then LEASE passes only when that run exited non-zero and the re-run exited zero
    And LEASE is "inconclusive" when the upgrade finished before its lease could be taken

  @unit
  Scenario: A step killed by SIGKILL that never settles reproduces SIGKILL
    Given a background step running when the head worker received SIGKILL
    When the step is not done or not-needed after the worker restarted and settled
    Then SIGKILL is "reproduced"

  @unit
  Scenario: A second upgrade run that changes any step reproduces NO-OP
    Given a settled ledger
    When a second upgrade run changes any step's status, attempt or finish time
    Then NO-OP is "reproduced"

  @unit
  Scenario: A private ClickHouse target behind the shared one reproduces TARGETS
    Given one organisation routed to a private ClickHouse
    When the private target's goose version differs from the shared one or it has no ledger rows
    Then TARGETS is "reproduced"

  @unit
  Scenario: Scale is measured but judged only against ruled bounds
    Given a scale run's memory samples and step durations
    When no bounds file was given
    Then SCALE reports the worker's peak memory and the slowest step and is "inconclusive"
    When bounds are given and a step or the worker exceeds them
    Then SCALE is "reproduced"

  @e2e @unimplemented
  Scenario: Rollback, re-upgrade and failure drills from 3.20.1 and from origin/main
    Given phases 0 to 2 have run
    When head stops, the old image serves head's schema and the smoke writes through it
    And head re-upgrades with its runner lease taken once, a worker killed and ClickHouse paused
    Then the report records ROLLBACK, REUPGRADE, LEASE, SIGKILL, NO-OP and TARGETS with their evidence

  @e2e @unimplemented
  Scenario: Phases 0 to 2 from 3.20.1 against today's head
    Given the published 3.20.1 image seeded through its own api, its worker paused with jobs queued
    When head's upgrade runs while the old api serves and head's api and worker start beside it
    Then the report records the ledger, R01, R02, F-1, F-2 and Q09 with their evidence

  @e2e @unimplemented
  Scenario: Phases 0 to 2 from origin/main against today's head, in both stop orders
    Given an image built from origin/main seeded through its own api
    When the old api stops first, and in a second run the old worker stops first
    Then each report counts the jobs left, dead-lettered and refused at the cut

  @e2e @unimplemented
  Scenario: A fresh install from an empty database
    When head's upgrade runs on empty stores and head's api and worker start
    Then every data step is not-needed or done and a second upgrade applies nothing
