@unit
Feature: Entitlement Checking
  As a developer
  I want to check if a plan has a specific entitlement
  So that I can gate features appropriately

  # hasEntitlement function
  Scenario: Enterprise plan has custom-rbac entitlement
    Given the plan is "self-hosted:enterprise"
    When I check hasEntitlement for "custom-rbac"
    Then it should return true

  Scenario: OSS plan does not have custom-rbac entitlement
    Given the plan is "self-hosted:oss"
    When I check hasEntitlement for "custom-rbac"
    Then it should return false

  # requireEntitlement function
  Scenario: requireEntitlement throws FORBIDDEN for missing entitlement
    Given the plan is "self-hosted:oss"
    When I call requireEntitlement for "custom-rbac"
    Then it should throw a TRPCError with code "FORBIDDEN"
    And the error message should mention "custom-rbac"

  Scenario: requireEntitlement does not throw for present entitlement
    Given the plan is "self-hosted:enterprise"
    When I call requireEntitlement for "custom-rbac"
    Then it should not throw
