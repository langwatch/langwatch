# IMAGE-IDENTITY (Alex, 2026-10-10; ARCHITECTURE.md section 7) over the release baseline. The
# manifests start at 3.19.0, so every step shipped at or before their first `previous` (3.18.1)
# is stamped by releases/baseline/baseline.json, read once from the release tag.

Feature: Steps shipped before the first manifest count as released
  As an operator of a LangWatch installation
  I want an image built from a release to name that release
  So that roster releases and rollback reopening see a real release

  @unit
  Scenario: The baseline holds every step shipped at the first manifest's previous release
    Given the release manifests and the release baseline this image ships
    When the baseline is read
    Then it names the first manifest's previous release
    And no step it holds is named by a manifest

  @unit
  Scenario: On this image's tree only steps newer than every stamped step are unstamped
    Given this image's own Prisma folders and goose files
    When the image's unstamped steps are listed
    Then no step the baseline holds is among them
    And every unstamped Prisma folder and goose file is newer than every stamped one of its kind

  @unit
  Scenario: An image shipping only steps from the baseline names the baseline's release
    Given a tree holding only steps the baseline holds and no manifest
    When the image names its release
    Then it names the baseline's release

  # OPS-13: a dev image names no release, so its newest manifest bounds what it can preview.
  @unit
  Scenario: An unreleased image refuses a preview to a release newer than its newest manifest
    Given an unreleased image shipping manifests up to 3.23.0
    When the preview asks for 3.24.0
    Then the preview is refused as a target this image does not ship
    And it names the command that previews from the target image

  @unit
  Scenario: An unreleased image previews to a release it ships a manifest for
    Given an unreleased image shipping manifests up to 3.23.0
    When the preview asks for 3.22.0
    Then the plan stops at 3.22.0
