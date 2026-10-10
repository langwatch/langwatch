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
  Scenario: Main's tab reconnecting its tRPC WebSocket just after the switch is tolerated
    Given the walker's tab loaded main's UI before the switch
    When main's UI reconnects its tRPC WebSocket within a minute after the switch and head refuses it
    Then it is counted apart, since head serves no tRPC WebSocket and its UI opens none
    And the same failure before the switch, later than a minute after, or on another socket stays a finding

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

  # Judged by: E6 (the cloud-sso profile: the cell's own idpsim behind main's NEXTAUTH_PROVIDER=oidc)
  @e2e @unimplemented
  Scenario: E6: A plain member signs in through the deployment's SSO before and after the upgrade
    Given main signs in through the cell's identity provider and an organization pins its domain to it
    And a plain member of that organization, no admin, no operator, signed in through it on main and landed on the project
    When the run cuts over to the branch, the upgrade ledger is done and the member signs in again
    Then the member lands on the same project, not on onboarding, an error or a blank page
    And the session cookie main issued is still valid on the branch, or sends the member cleanly to sign in
    And a 5xx, a blank page or a sign-in that ends nowhere fails the scenario with the page the member saw

  # Judged by: E7
  @e2e @unimplemented
  Scenario: E7: A member of an organization's own SSO connection signs in before and after the upgrade
    Given on main the seed organization's admin takes a connection live against the cell's identity provider: an enterprise subscription, the self-serve flag, the domain claimed and proved, a recorded test sign-in, a break-glass binding, the arrival policy chosen, then activate
    And a plain member of that organization signed in through the connection on main and landed on the project
    When the run cuts over to the branch, the upgrade ledger is done and the member signs in again
    Then the member lands on the same project, and the cookie main issued is still valid or sends them cleanly to sign in
    And the branch's setup read shows the same connection ACTIVE
    And a ceremony step main refuses fails the scenario naming that step, and a 5xx, a blank page or a sign-in that ends nowhere fails it with the page the member saw

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

  @unit
  Scenario: Tier M lays out seedgen's medium tenancy with the rare subscription states
    When the tenancy is built for tier M
    Then it holds 12 organizations, 48 projects and 400 users
    And its subscriptions hold ACTIVE, PENDING, FAILED and CANCELLED

  @unit
  Scenario: Tier M seeds through main's doors against a URL
    Given a running main reachable only by its URL
    When the heavy seed runs
    Then telemetry reaches the OTLP door with each live project's key
    And every product and REST kind with a door is created in each new organization
    And a refused kind is named while the others are still created

  @unit
  Scenario: A heavy seed packs cells into requests up to the chunk bounds without changing a single id or timestamp
    Given a plan's telemetry chunks, each one cell of one project
    When the heavy seed packs them into requests
    Then each request holds one project, one kind, and only backdated or only normal chunks
    And no request passes 500 spans, 1,000 records or 4 MB
    And the packed requests carry exactly the spans, records and points the chunks did, ids and timestamps included

  # Self-hosted install paths (W4): tools/upgradelab/selfhosted and cell/selfhosted.go.
  @unit
  Scenario: A self-hosted run performs the upgrade guide's commands in order and names each deviation
    Given the compose and helm plans of a self-hosted run
    When they reach the upgrade phase
    Then compose runs the guide's copy, docker compose pull and docker compose up -d, in that order and as written
    And helm runs the guide's helm upgrade with its deviation named, and records helm repo update as not run

  @unit
  Scenario: The guide rows fail when a guide command failed or deviated, or compose needed a step the guide omits
    Given a self-hosted transcript
    When a guide command exited non-zero, ran with a deviation, or a harness command ran during the upgrade phase
    Then U2 or U5 fails, naming the command

  @unit
  Scenario: U6 fails when the probe found the api down during helm upgrade
    Given the probe's phases during helm upgrade
    When any phase is down
    Then U6 fails with the times it was unanswered

  @unit
  Scenario: E5 passes only when the settled Ops > Upgrades page shows an upgrade state
    Given the settled shot of Ops > Upgrades
    When it shows Access Restricted, or no settled shot was taken
    Then E5 fails

  @unit
  Scenario: The ADMIN_EMAILS-unset variant boots with no ADMIN_EMAILS at all
    Given the self-hosted-free-no-admin profile
    When the operator environment is built
    Then it holds no ADMIN_EMAILS, while the free variant lists the seed account

  @unit
  Scenario: E1 fails when the licence copy step is missing or a licensed organisation lost its key
    Given the ledger and the count of licensed organisations without a key
    When the copy step is absent, or any organisation lost its key
    Then E1 fails

  @unit
  Scenario: A tier M cell carries its tier in its name, its stores and its cache key
    Given the options -tier M and -no-admin-emails
    When the cell is named and the flags are parsed
    Then the name says m, the flag is set, and a tier S cache key is unchanged

  @unit
  Scenario: The self-hosted rows are named and mapped to their scenarios in the report
    Given the E and U ids
    When the report tables are read
    Then each has a name and maps to its own scenario
