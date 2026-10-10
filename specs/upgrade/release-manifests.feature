# Release manifests, the LTS floor and the upgrade plan: slice S2 of
# dev/docs/plans/migrations-rethink-2026-10-06.md (6.3, 6.4, 6.5) and lane mig-s2-manifests of
# dev/docs/plans/migrations-blitz-2026-10-06.md (3.2, 5.3; D3, D9, D10).
#
# A manifest is what "attached to a release" means: packages/upgrade/releases/<version>.json names
# every step id the release shipped, Prisma folders by name, goose versions ascending, then code
# steps in installed-module order. The stamp generator writes it in the release PR. The LTS floor
# (packages/upgrade/releases/lts-floor.json) is the oldest release an image upgrades from.
# The plan is pure: it reads the ledger and the manifests and never touches a database.

Feature: Release manifests order every migration step release by release
  As an operator upgrading a self-hosted installation across several releases
  I want each step attached to the release that shipped it and run in that release's order
  So that a jump of several releases replays them one by one and never skips the LTS stop

  @unit
  Scenario: A stamped manifest lists Prisma folders, then goose versions, then code steps
    Given a tree with two new Prisma folders, two new goose files and one declared code step
    When the release is stamped
    Then the Prisma folders come first in name order
    And the goose versions follow in ascending order
    And the declared code step comes last, with its own kind, mode, owner and description

  @unit
  Scenario: A step the previous release or an earlier manifest shipped is not stamped again
    Given a Prisma folder present at the previous release's tag
    And a code step named by an earlier manifest
    When the next release is stamped
    Then neither appears in the new manifest

  @unit
  Scenario: A schema step is owned by the one module owning every table it touches
    Given a Prisma migration that alters two tables of the same module
    When its owner is attributed
    Then the step's owner is that module

  @unit
  Scenario: A schema step touching two modules' tables, or an unowned table, has no owner
    Given a Prisma migration that alters a table of each of two modules
    When its owner is attributed
    Then the step's owner is empty

  @unit
  Scenario: The release workflow reads each table's owner from the architecture enforcer
    Given a Prisma table and a ClickHouse table each written by one module, and a table no module writes
    When the architecture enforcer prints the table-to-owner map
    Then each owned table appears under the name its migrations use, with its module
    And the table no module writes is absent, so a step touching it has no owner

  @unit
  Scenario: A step id named by two manifests is refused when the manifests load
    Given two manifests that both name the same Prisma folder
    When the manifests are loaded
    Then loading is refused naming the step id and both releases

  @unit
  Scenario: The shipped deprecation register names the retired project scope tables
    Given packages/upgrade/releases/deprecations/deprecations.json as this image ships it
    When the register is loaded
    Then it names DataPrivacyProjectScope and DataRetentionProjectScope as deprecated Postgres tables
    And each says what replaces it and that it is removed in a future release

  @unit
  Scenario: A deprecation removed before it is deprecated, or named twice, is refused
    Given a register whose entry is removed in 3.21.0 but deprecated in 3.22.0
    When the register is loaded
    Then loading is refused naming the entry and both releases

  @unit
  Scenario: A manifest whose file name is not its release is refused
    Given a manifest file named 3.21.0.json whose release reads 3.22.0
    When the manifests are loaded
    Then loading is refused naming the file

  @unit
  Scenario: The shipped manifests chain from the backfill start to the LTS floor
    When the manifests and the LTS floor shipped in the package are loaded
    Then the LTS floor names release 3.20.1
    And every release from 3.19.0 to 3.20.1 has a manifest whose previous release is the one before it

  @unit
  Scenario: An upgrade across several releases steps release by release
    Given an installation recorded at 3.20.1 with an LTS floor of 3.19.0
    And manifests for 3.21.0, 3.22.0 and 3.23.0
    When an image of 3.23.0 plans its upgrade
    Then the plan holds 3.21.0, 3.22.0 and 3.23.0 in that order
    And each release lists its schema ids, its blocking steps and its background steps from its own manifest

  @unit
  Scenario: Steps the ledger records as done or not needed are left out of the plan
    Given an installation whose ledger already records one of the next release's schema steps as done
    When the upgrade is planned
    Then that release is still planned
    And the done step is not in it

  @unit
  Scenario: An installation below the LTS floor is refused by the name of the LTS to stop at
    Given an installation recorded at 3.16.0 with an LTS floor of 3.20.1
    When an image of 3.23.0 plans its upgrade
    Then the plan is refused before anything runs
    And the refusal says to upgrade to 3.20.1 (LTS) first

  @unit
  Scenario: An image below the ledger's floor is refused
    Given a ledger that records a floor of 3.22.0 from an earlier upgrade
    When an image of 3.21.0 plans its upgrade
    Then the plan is refused naming the image's release and the ledger's floor

  @unit
  Scenario: A fresh install applies all schema at once and needs no data, tenant or procedure step
    Given a database with no installed release
    When an image of 3.23.0 plans its upgrade
    Then the plan holds one release carrying every schema id of every manifest
    And every data, tenant and procedure step is marked not needed

  @unit
  Scenario: A cloud image with only unreleased steps plans one virtual release
    Given an installation recorded at the newest released manifest
    And an image built from a commit, not a release, declaring steps no manifest names
    When the image plans its upgrade
    Then the plan holds exactly one virtual release carrying those steps

  # IMAGE-IDENTITY (Alex, 2026-10-10): the image names a release only when it is that release.
  @unit
  Scenario: An image shipping only stamped steps names itself the newest release
    Given release manifests stamped up to 3.20.1
    And an image whose every schema and code step a manifest lists
    When the image's release is derived
    Then the image names itself 3.20.1

  @unit
  Scenario: An image shipping a step beyond the stamped ones names itself unreleased
    Given release manifests stamped up to 3.20.1
    And an image shipping a step no manifest lists
    When the image's release is derived
    Then the image names itself unreleased

  # Preview to a target (upgrade-ui plan 6.1.2, U6; Q-U3 ruled: the preview runs from the target
  # image's CLI, so this image never fetches another release's manifests).
  @unit
  Scenario: A preview to a target release stops at that release
    Given an installation recorded at 3.20.1 and an image of 3.23.0
    When the upgrade is previewed to 3.22.0
    Then the plan holds 3.21.0 and 3.22.0 in that order and nothing later

  @unit
  Scenario: A preview to a release this image does not ship prints the command that previews from the target image
    Given an image of 3.23.0
    When the upgrade is previewed to 3.24.0
    Then the preview is refused with the code "target_not_in_image"
    And the refusal names "pnpm task upgrade plan --to 3.24.0" run from the 3.24.0 image
