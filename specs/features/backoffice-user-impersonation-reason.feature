Feature: Backoffice User Impersonation Reason
  As an ops admin
  I want to enter an impersonation reason in a single-line field
  So that I can quickly submit the audit reason without adding accidental line breaks

  Background:
    Given an ops admin is viewing the backoffice users page
    And the users table includes an active user named "Yoel Ernst"

  @integration @unimplemented
  Scenario: Impersonation dialog asks for a single-line reason
    When the ops admin chooses to impersonate "Yoel Ernst"
    Then an "Impersonate user" dialog is visible
    And the dialog explains the reason is saved to the audit log
    And the reason field accepts a single line of text

  @integration @unimplemented
  Scenario: Enter submits a completed impersonation reason
    Given the ops admin has opened the impersonation dialog for "Yoel Ernst"
    And the reason field contains "support"
    When the ops admin presses Enter in the reason field
    Then impersonation is submitted for "Yoel Ernst"
    And the submitted reason is "support"

  @integration @unimplemented
  Scenario: Empty reason still blocks impersonation
    Given the ops admin has opened the impersonation dialog for "Yoel Ernst"
    And the reason field is empty
    When the ops admin presses Enter in the reason field
    Then impersonation is not submitted
    And the ops admin is told that a reason is required
