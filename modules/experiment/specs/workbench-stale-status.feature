Feature: One stale workbench signal
  @integration
  Scenario: Reloading a stale workbench requires confirmation
    Given a workbench with unsaved edits and a newer API version
    When I click Out of date in the header
    Then the confirmation explains that Reload discards my unsaved edits
    And cancelling preserves those edits
    And confirming reloads the latest version

  @integration
  Scenario: A failed reload can be retried
    Given an out of date workbench
    When reloading fails
    Then the reload error is reported
    And I can retry from the confirmation
