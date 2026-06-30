Feature: Dedicated Langy API key provisioning
  As a project owner
  I want each of my projects to have its own dedicated, least-privilege Langy key
  So that the Langy assistant can act on my project without reusing my personal key,
  and so that a leaked key exposes only this project and only what Langy needs

  Background:
    Given I am signed in as an admin of my organization

  # ---------------------------------------------------------------------------
  # New projects
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Creating a project provisions a dedicated Langy key
    When I create a new project
    Then the project has a dedicated API key named "Langy"
    And the Langy key is separate from the project's own ingestion API key
    And the Langy key is not owned by any individual user

  @integration
  Scenario: The Langy key is scoped to only its own project
    Given I have two projects "Alpha" and "Beta"
    When a Langy key is provisioned for "Alpha"
    Then the Langy key for "Alpha" can act only within "Alpha"
    And the Langy key for "Alpha" cannot access "Beta"

  @integration
  Scenario: The Langy key grants only the access Langy needs
    When I create a new project
    Then the Langy key cannot perform organization-level administration
    And the Langy key can perform only the actions the Langy assistant requires

  # ---------------------------------------------------------------------------
  # Existing projects (backfill)
  # ---------------------------------------------------------------------------

  # Bulk backfill scripts were dropped in PR #4913 per review — Langy
  # auto-provisions its key on first use instead, so any project predating
  # the feature self-heals the moment a chat is started against it.

  @integration
  Scenario: Existing projects without a Langy key heal on first call
    Given a project that was created before Langy keys existed
    And that project has no Langy key
    When provisionLangyApiKey runs for that project (first-chat heal path)
    Then that project has a dedicated Langy key named "Langy"

  @integration
  Scenario: Repeated heal calls do not create duplicates
    Given a project that already has a Langy key
    When provisionLangyApiKey runs again for that project
    Then the project still has exactly one Langy key

  # ---------------------------------------------------------------------------
  # Lifecycle
  # ---------------------------------------------------------------------------

  # Not yet implemented — no Langy-key revoke flow exists yet; flagged so the
  # feature-parity check tolerates it until the revoke behaviour is built.
  @unimplemented
  @integration
  Scenario: An admin can revoke the Langy key
    Given my project has a Langy key
    When I revoke the Langy key
    Then the Langy key can no longer act on my project
    And my project's other API keys are unaffected
