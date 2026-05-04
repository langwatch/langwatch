Feature: Custom labels in Deploy dialog
  As a LangWatch user
  I want to add custom tags (beyond production/staging) in the Deploy dialog
  So that I can manage environment-specific prompt versions for my team's workflow

  # All 8 remaining @unimplemented scenarios are KEEP/UPDATE per AUDIT_MANIFEST.md:
  # DeployPromptDialog rendering (built-in/custom rows, delete buttons, empty state,
  # add/remove flows, duplicate-name rejection) is fully covered by
  # DeployPromptDialog.integration.test.tsx. Validation (lowercase, no-digits,
  # protected-tag rejection) is covered by prompt-tag.service.unit.test.ts.
  # Remaining scenarios assert deeper integration: cascade-to-assignments on delete,
  # reassignment overwrite, custom-vs-built-in fetch resolution, undefined-tag rejection,
  # and getTagsForConfig mixed listing. Aspirational pending KEEP-class integration
  # tests + UPDATE wording fixes around "production"/"staging" as built-ins (only
  # "latest" is in PROTECTED_TAGS now). Tracked in PR #3458.

  Background:
    Given I am logged into project "my-project"
    And a prompt "pizza-prompt" with versions v1, v2, v3

  # --- Backend: Custom tag definitions ---
  # Tag definitions are organization-scoped.

  @unit @unimplemented
  Scenario: Built-in tags are always available
    When I check the built-in tag list
    Then "latest", "production", and "staging" are included
    And they are marked as built-in

  @unit @unimplemented
  Scenario: Custom tags cannot shadow built-in tags
    When I try to create a tag named "production"
    Then the operation fails because it conflicts with a built-in tag

  @integration @unimplemented
  Scenario: Deleting a custom tag cascades to assignments
    Given "canary" is a custom tag assigned to v2 of "pizza-prompt"
    When I delete the tag "canary"
    Then the PromptTag record for "canary" is removed
    And no PromptVersionTag records reference "canary"

  # --- Backend: Assigning custom tags to versions ---

  @integration @unimplemented
  Scenario: Assigning a custom tag to a version
    Given "canary" is a custom tag for the organization
    When I assign "canary" to v2 of "pizza-prompt"
    Then a PromptVersionTag record exists with tag "canary" pointing to v2

  @integration @unimplemented
  Scenario: Reassigning a custom tag to a different version
    Given "canary" is a custom tag assigned to v2 of "pizza-prompt"
    When I reassign "canary" to v3
    Then fetching with tag "canary" returns v3

  @integration @unimplemented
  Scenario: Fetching with a custom tag returns the tagged version
    Given "canary" is assigned to v2 of "pizza-prompt"
    When I fetch "pizza-prompt" with tag "canary"
    Then I receive version v2

  @integration @unimplemented
  Scenario: Rejecting assignment of an undefined custom tag
    When I try to assign "nonexistent" to v2 of "pizza-prompt"
    Then the operation fails with a validation error

  # --- Backend: Tag listing for a prompt config ---

  @integration @unimplemented
  Scenario: Listing tags for a prompt config includes custom tags
    Given "production" is assigned to v1
    And "canary" is a custom tag assigned to v2
    When I list tags for "pizza-prompt"
    Then I see "production" pointing to v1 and "canary" pointing to v2

  # --- UI: Deploy dialog shows tags ---
