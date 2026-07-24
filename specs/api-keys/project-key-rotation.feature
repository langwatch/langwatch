@integration
Feature: Rotate the project base API key
  As a project admin
  I want to rotate the project's base (legacy) API key from the API Keys page
  So that I can replace a compromised key without losing the supported,
  permission-gated, audited path the unified-keys rework removed

  Background:
    Given a project that has a base API key
    And I am on the Settings > API Keys page

  Scenario: An admin rotates the base key and sees the new key once
    Given I have permission to manage the project
    When I rotate the project base API key and confirm
    Then a new base API key is generated for the project
    And the new key is shown to me once

  Scenario: Rotation invalidates the previous base key
    Given the project base API key authenticates requests for that project
    When I rotate the project base API key
    Then the previous base key no longer authenticates any request
    And the new base key authenticates requests scoped to that project

  Scenario: Rotation requires permission to manage the project
    Given I do not have permission to manage the project
    Then no control to rotate the project base API key is offered to me
    And a direct attempt to rotate the base key is rejected
    And the base key is left unchanged

  Scenario: The base key keeps working until it is explicitly rotated
    Given other API keys are created and revoked in the project
    When I have not rotated the project base API key
    Then the base key still authenticates requests for that project

  Scenario: Rotation is recorded for audit
    When I rotate the project base API key
    Then the rotation is recorded as an audited action for the project

  Scenario: A failed rotation leaves the previous base key working
    Given rotating the base key fails
    Then the previous base key still authenticates requests for that project
    And I am shown an error explaining the rotation did not happen
