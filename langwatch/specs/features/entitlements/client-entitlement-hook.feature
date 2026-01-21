@integration
Feature: Client-Side Entitlement Hook
  As a React component
  I want to check entitlements client-side
  So that I can conditionally render UI based on plan

  Scenario: useHasEntitlement returns true for entitled feature
    Given publicEnv returns SELF_HOSTED_PLAN as "self-hosted:enterprise"
    When I call useHasEntitlement("custom-rbac")
    Then it should return true

  Scenario: useHasEntitlement returns false for non-entitled feature
    Given publicEnv returns SELF_HOSTED_PLAN as "self-hosted:oss"
    When I call useHasEntitlement("custom-rbac")
    Then it should return false

  Scenario: useHasEntitlement returns true while loading
    Given publicEnv is still loading
    When I call useHasEntitlement("custom-rbac")
    Then it should return true to avoid flash of locked UI
