# The soak rounds' scenarios (dev/docs/plans/upgrade-soak-rounds-2026-10-10.md section 8.3): every row of the
# scenario table is one scenario here, and the comment above it names the cell check that judges it.
# Harness: tools/upgradelab (`upgradelab cell`); the report's Scenarios column carries these ids.

Feature: Each soak round proves the upgrade is safe on production-shaped data under live traffic
  As the maintainer shipping a release that migrates stored data
  I want every scenario of the run sheet judged by a named check
  So that a round is green only when each scenario it owns passed

  Background:
    Given a cell's stores are dedicated databases named upgradelab_<cell> and its own Redis
    And the round's snapshot is restored, main runs on it and traffic is on

  # Judged by: N1, N6
  @e2e @unimplemented
  Scenario: S1: The api answers every call from its first second; no call goes unanswered
    When the run cuts over to the branch and settles
    Then scenario S1 holds

  # Judged by: N5
  @e2e @unimplemented
  Scenario: S2: Ingest never answers a non-2xx, on any attempt
    When the run cuts over to the branch and settles
    Then scenario S2 holds

  # Judged by: N2, D1
  @e2e @unimplemented
  Scenario: S3: A read that meets a schema still behind gets 503 upgrade_in_progress with Retry-After and succeeds on retry
    When the run cuts over to the branch and settles
    Then scenario S3 holds

  # Judged by: N3
  @e2e @unimplemented
  Scenario: S4: Every 2xx write is visible after settle
    When the run cuts over to the branch and settles
    Then scenario S4 holds

  # Judged by: N4
  @e2e @unimplemented
  Scenario: S5: Jobs queued at the cut drain on the branch worker with no unexpected dead letter
    When the run cuts over to the branch and settles
    Then scenario S5 holds

  # Judged by: I0
  @e2e @unimplemented
  Scenario: S6: The branch worker runs the upgrade and the api runs no step
    When the run cuts over to the branch and settles
    Then scenario S6 holds

  # Judged by: I2, I2b
  @e2e @unimplemented
  Scenario: S7: Every step ends done or not-needed on every target and nothing is reopened
    When the run cuts over to the branch and settles
    Then scenario S7 holds

  # Judged by: I4
  @e2e @unimplemented
  Scenario: S8: No table loses rows and every pre-existing event is still there
    When the run cuts over to the branch and settles
    Then scenario S8 holds

  # Judged by: I6
  @e2e @unimplemented
  Scenario: S9: Every seeded id reads back through the branch and old and upgraded copies answer every GET the same
    When the run cuts over to the branch and settles
    Then scenario S9 holds

  # Judged by: I5
  @e2e @unimplemented
  Scenario: S10: Read models are filled: trace meter per organisation per month, open suite runs, privacy and retention resolve
    When the run cuts over to the branch and settles
    Then scenario S10 holds

  # Judged by: I9, B1
  @e2e @unimplemented
  Scenario: S11: No new error signature in api, worker or task logs and no browser console error
    When the run cuts over to the branch and settles
    Then scenario S11 holds

  @unit
  Scenario: Only an upgrade_in_progress 503 with Retry-After between the switch and ready is expected noise
    Given the browser walk records a failed request
    When it is a 503 with code upgrade_in_progress, a Retry-After header, between the switch and ready
    Then it is counted apart as expected while steps run
    And a 503 without Retry-After, another status or code, or any time outside that window stays a finding

  @unit
  Scenario: Only listed log signatures are accepted, the upgrade error only between the switch and ready
    Given an error line in head's api or worker log
    When it matches an accepted signature
    Then it is counted apart with that signature's reason
    And UpgradeInProgressError is accepted only between the switch and ready, every other line fails I9

  # Judged by: O1
  @e2e @unimplemented
  Scenario: S12: Ops > Upgrades walks Behind, Upgrading, Finishing in background, Up to date with no error flash
    When the run cuts over to the branch and settles
    Then scenario S12 holds

  # Judged by: I8
  @e2e @unimplemented
  Scenario: S13: A second upgrade changes nothing
    When the run cuts over to the branch and settles
    Then scenario S13 holds

  # Judged by: I7
  @e2e @unimplemented
  Scenario: S14: Every stored event parses under the branch's schemas and upcasts
    When the run cuts over to the branch and settles
    Then scenario S14 holds

  # Judged by: H1
  @e2e @unimplemented
  Scenario: H1: Hybrid data lands only on its own target
    When the run cuts over to the branch and settles
    Then scenario H1 holds

  # Judged by: H2
  @e2e @unimplemented
  Scenario: H2: Hybrid: every target is migrated
    When the run cuts over to the branch and settles
    Then scenario H2 holds

  # Judged by: H3
  @e2e @unimplemented
  Scenario: H3: A private organisation reads its own data
    When the run cuts over to the branch and settles
    Then scenario H3 holds

  # Judged by: H4
  @e2e @unimplemented
  Scenario: H4: Hybrid objects land only in their tenant's bucket
    When the run cuts over to the branch and settles
    Then scenario H4 holds

  # Judged by: H5
  @e2e @unimplemented
  Scenario: H5: A shared organisation cannot read a private organisation's data
    When the run cuts over to the branch and settles
    Then scenario H5 holds

  # Judged by: licensing step plus a read
  @e2e @unimplemented
  Scenario: E1: The licence carries over and enterprise features stay on
    When the run cuts over to the branch and settles
    Then scenario E1 holds

  # Judged by: SSO traffic stream
  @e2e @unimplemented
  Scenario: E2: SSO sign-in works before, during and after the switch
    When the run cuts over to the branch and settles
    Then scenario E2 holds

  # Judged by: SCIM stream and user count
  @e2e @unimplemented
  Scenario: E3: SCIM pushed mid-upgrade lands once
    When the run cuts over to the branch and settles
    Then scenario E3 holds

  # Judged by: grants flow
  @e2e @unimplemented
  Scenario: E4: Custom roles and grants behave as on main: a key with no grant is refused
    When the run cuts over to the branch and settles
    Then scenario E4 holds

  # Judged by: operator read
  @e2e @unimplemented
  Scenario: E5: ADMIN_EMAILS set makes that user operator after the upgrade; unset, the documented bootstrap works
    When the run cuts over to the branch and settles
    Then scenario E5 holds

  # Judged by: I2
  @e2e @unimplemented
  Scenario: F1: Fresh install: every data step is not-needed and the api serves
    When the run cuts over to the branch and settles
    Then scenario F1 holds

  # Judged by: I8
  @e2e @unimplemented
  Scenario: F2: A second run on a fresh install is a no-op
    When the run cuts over to the branch and settles
    Then scenario F2 holds

  # Judged by: forced failure plus screenshot
  @e2e @unimplemented
  Scenario: F3: The first-install token console shows only when the first install fails
    When the run cuts over to the branch and settles
    Then scenario F3 holds

  # Judged by: screenshots plus Haiku
  @e2e @unimplemented
  Scenario: U1: The holding and upgrading pages are branded, centred and say what is happening
    When the run cuts over to the branch and settles
    Then scenario U1 holds

  # Judged by: R5 operator transcript
  @e2e @unimplemented
  Scenario: U2: The upgrade guide's commands work exactly as written
    When the run cuts over to the branch and settles
    Then scenario U2 holds

  # Judged by: overlay rows, D3
  @e2e @unimplemented
  Scenario: U3: Ops > Upgrades explains a held tenant and a failed step and Retry fixes the failed one
    When the run cuts over to the branch and settles
    Then scenario U3 holds

  # Judged by: Haiku plus Alex skim
  @e2e @unimplemented
  Scenario: U4: An operator can tell from the panel alone when it is safe to stop the old release
    When the run cuts over to the branch and settles
    Then scenario U4 holds

  # Judged by: R5 transcript
  @e2e @unimplemented
  Scenario: U5: compose up with the new image needs no step the docs omit
    When the run cuts over to the branch and settles
    Then scenario U5 holds

  # Judged by: S1 on the kind stack
  @e2e @unimplemented
  Scenario: U6: helm upgrade rolls with no unanswered call
    When the run cuts over to the branch and settles
    Then scenario U6 holds
