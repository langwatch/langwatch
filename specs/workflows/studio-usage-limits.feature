Feature: Usage-limit feedback inside the optimization studio
  As a free-plan user working in the workflow editor
  I want plan-limit errors to surface immediately on top of the studio
  So that a blocked save never looks like a silent failure

  # Customer context: editing dataset columns from inside the workflow
  # editor silently did nothing at the free-plan limit. The limit-exceeded
  # dialog only mounts in the dashboard layout, and the studio route does
  # not use that layout, so the dialog "appeared" only after navigating
  # back. Any plan-limited mutation fired from the studio must raise the
  # upgrade dialog above the studio UI, including above open node drawers
  # and dialogs.

  Background:
    Given I am logged in on the free plan
    And I have a workflow open in the optimization studio

  @integration @unimplemented
  Scenario: Limit-exceeded mutation raises the upgrade dialog over the studio
    Given my organization is at its plan limit for datasets
    When a dataset save from inside the studio is rejected with a limit-exceeded error
    Then the upgrade dialog opens on top of the studio canvas
    And it explains which limit was reached and how to upgrade

  @unimplemented
  Scenario: Upgrade dialog stacks above open studio dialogs
    Given a dataset editing dialog is open inside the studio
    When a save inside that dialog hits a plan limit
    Then the upgrade dialog renders above the dataset dialog, not behind it

  @unimplemented
  Scenario: Dismissing the upgrade dialog returns to an intact editor
    Given the upgrade dialog opened over the studio
    When I dismiss it
    Then the workflow canvas and any open drawer are still functional
    And my unsaved edits are preserved
