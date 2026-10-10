Feature: Generating a typical upgrade snapshot from an old release
  As the upgrade harness
  I want `upgradelab generate` to plan a seeded run against a booted old release
  So that every must-have cell starts from state the old release wrote itself, the same for one seed

  Plan: .claude/tmp/handoffs/plan-upgrade-snapshots.md, sections 2, 3 and lane L3 (rulings D2, D3, D12).
  Producers run in CI only, against the old image. The plan names the doors in order: stores up,
  the old release up, tenancy SQL, old tRPC product seeds, old REST/OTLP traffic through workerrun,
  pause the old worker, traffic queued at the cut, then capture through the snapshot package.

  @unit
  Scenario: a plan names every door in order
    When I plan shape "sh-free" from release "3.20.1" at volume "S" with seed 1
    Then the steps are stores-up, old-release-up, tenancy-sql, product-seeds, traffic, pause-worker, traffic-at-cut, capture

  @unit
  Scenario: one seed gives one logical plan
    When I plan shape "saas" from release "main@abc1234" at volume "S" with seed 7 twice with one anchor
    Then both plans have the same digest
    And a plan with seed 8 has a different digest

  @unit
  Scenario: tenancy ids come from the cell, kind and index
    When I plan shape "hybrid" from release "main@abc1234" at volume "S" with seed 1
    Then every organisation, team, project and user id reads "snap_<cell>_<kind>_<n>"
    And the tenancy holds 4 organisations, 6 teams, 12 projects and 40 users
    And users are active, deactivated, unconfirmed and never signed in
    And every instant lies in the anchor's month or the one before

  @unit
  Scenario: the saas shapes seed active subscriptions by SQL
    When I plan shape "saas" from release "main@abc1234" at volume "S" with seed 1
    Then the tenancy SQL writes one ACTIVE subscription without a Stripe id per organisation
    And the self-hosted shapes write no subscription

  @unit
  Scenario: the hybrid shape routes one organization to a private ClickHouse and S3
    When I read the "hybrid" shape env
    Then it names CLICKHOUSE_URL__snap__ and DATAPLANE_S3__snap__ for the private organisation

  @unit
  Scenario: shape env files hold test values and name their secrets
    When I read each shape env
    Then secret-named keys are listed as secret names, never as manifest env values

  @unit
  Scenario: every declared migration step is covered
    When I read every defineMigrationStep and defineProjectionReplayStep id in the modules
    Then coverage.json maps each one to the seed that feeds it or says why the old release cannot hold it

  @unit
  Scenario: an unknown shape is refused
    When I plan shape "cloud" from release "3.20.1" at volume "S" with seed 1
    Then planning fails naming the four shapes

  @unit
  Scenario: a release below the floor is refused
    When I plan shape "sh-free" from release "3.19.4" at volume "S" with seed 1
    Then planning fails naming the floor 3.20.1

  @unit
  Scenario: a saas shape from a release tag is refused
    When I plan shape "saas" from release "3.20.1" at volume "S" with seed 1
    Then planning fails saying cloud shapes come from main@<sha>

  @unit
  Scenario: a self-hosted shape from main is refused
    When I plan shape "sh-licensed" from release "main@abc1234" at volume "S" with seed 1
    Then planning fails saying self-hosted shapes come from a release tag

  @unit
  Scenario: volumes other than S are refused here
    When I plan shape "sh-free" from release "3.20.1" at volume "L" with seed 1
    Then planning fails saying volume L lands with the scale generator

  @unit
  Scenario: a failing door stops the run and names the step
    Given doors that fail at "product-seeds"
    When I execute a plan
    Then the run stops with an error naming "product-seeds"
    And no later door ran

  @unit
  Scenario: A generation run publishes its stores on ports no other run holds
    Given two generation runs planned at the same time
    When each builds its doors
    Then the app and the four store ports are all different across both runs

  @unit
  Scenario: each product kind is created through the old release's doors
    Given an old app that answers its sign-in, tRPC and collector doors
    When the product seeds run signed in as the seed account
    Then privacy, retention, annotation, workflow, slack, report and suite are each created by their tRPC mutation
    And the organisation, project, API key and trace come from the old app's own answers
    And the kinds with no headless seed are skipped naming why
    And no row is written by SQL

  @unit
  Scenario: a product kind the old app refuses fails the step naming the kind
    Given an old app that refuses "workflow.create"
    When the product seeds run
    Then every other kind is still created
    And the step fails naming "workflow" and the old app's answer

  @unit
  Scenario: a failed sign-in stops the run naming the step
    Given an old app that refuses the seed account's sign-in
    When the product seeds run
    Then the step fails saying the sign-in was refused
    And no product kind was requested

  @unit
  Scenario: a sign-in that sets no session cookie is refused
    Given an old app whose sign-in answers 200 without a better-auth session cookie
    When the product seeds run
    Then the step fails saying the sign-in set no session cookie

  @unit
  Scenario: an unknown recipe version is refused
    When a snapshot names recipe version 2
    Then it is refused naming version 2 and the known version 1

  @unit
  Scenario: a generated snapshot holds every expected product kind
    Given product seeds that created each seedable kind once
    When the expectation is checked after capture
    Then it passes

  @unit
  Scenario: an Expect miss names the kind and the count
    Given a captured snapshot whose old app lists no "suite"
    When the expectation is checked after capture
    Then it fails naming "suite", the count 0 and the expected count 1
