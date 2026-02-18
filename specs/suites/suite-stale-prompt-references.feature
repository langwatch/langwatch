Feature: Suite run validation for organization-scoped prompts
  As a LangWatch user
  I want suites to correctly resolve prompt targets across projects
  So that I can run suites referencing prompts from any project in my organization

  Background:
    Given I am logged into project "my-project" in organization "my-org"
    And the feature flag "release_ui_suites_enabled" is enabled

  # ============================================================================
  # Run Validation — Organization-Scoped Prompts
  # ============================================================================
  #
  # The suite form UI correctly shows org-scoped prompts from all projects
  # using an OR query. But validateTargetExists only checks the suite's
  # projectId, causing false "invalid target" errors for org-scoped prompts
  # created in a different project. The validation query must match the
  # same pattern used by the UI and the worker's data prefetcher.
  #

  @unit
  Scenario: Run validation accepts org-scoped prompt from another project
    Given an org-scoped prompt "Shared Bot" exists in project "other-project"
    And a suite in "my-project" references that prompt as a target
    When the suite run is triggered
    Then the run proceeds without validation errors

  @unit
  Scenario: Run validation accepts project-scoped prompt from same project
    Given a project-scoped prompt "Local Bot" exists in "my-project"
    And a suite in "my-project" references that prompt as a target
    When the suite run is triggered
    Then the run proceeds without validation errors

  @unit
  Scenario: Run validation rejects prompt from unrelated project without org scope
    Given a project-scoped prompt "Private Bot" exists in "other-project"
    And a suite in "my-project" references that prompt as a target
    When the suite run is triggered
    Then the run fails with an error about an invalid target reference

  @unit
  Scenario: Run validation rejects soft-deleted prompts
    Given a prompt "Retired Bot" has been soft-deleted
    And a suite still holds a reference to that prompt
    When the suite run is triggered
    Then the run fails with an error about an invalid target reference

  # ============================================================================
  # Edit Drawer — Deleted Prompt Warning
  # ============================================================================
  #
  # When a suite references a prompt that has been soft-deleted, the edit
  # drawer should warn the user. The stale reference is preserved — not
  # silently removed — so the user can decide what to do.
  #

  @integration
  Scenario: Edit drawer warns about deleted prompt targets
    Given suite "Critical Path" was saved with prompt targets "Active Bot" and "Deleted Bot"
    And "Deleted Bot" has since been soft-deleted
    When I open the edit drawer for "Critical Path"
    Then I see a warning that "Deleted Bot" is no longer available

  @integration
  Scenario: Edit drawer shows no warning when all references are valid
    Given suite "Critical Path" was saved with prompt target "Active Bot"
    And "Active Bot" still exists
    When I open the edit drawer for "Critical Path"
    Then I do not see a warning about deleted targets
