@integration
Feature: Entitlement tRPC Middleware
  As a developer
  I want tRPC middleware to check entitlements
  So that I can gate API endpoints by plan

  Background:
    Given I am authenticated as a user

  Scenario: Middleware allows request with valid entitlement
    Given LICENSE_KEY is set to "LW-ENT-test"
    And I call an endpoint protected by checkEntitlement("custom-rbac")
    Then the request should succeed

  Scenario: Middleware rejects request without entitlement
    Given no LICENSE_KEY is set
    And I call an endpoint protected by checkEntitlement("custom-rbac")
    Then the request should fail with FORBIDDEN
    And the error should mention "Please upgrade to LangWatch Enterprise"
