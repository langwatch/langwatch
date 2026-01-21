@unit
Feature: Plan to Entitlement Mapping
  As the entitlement system
  I want to map plans to their entitled features
  So that features can be gated appropriately

  # OSS plan entitlements
  Scenario: OSS plan has base SSO entitlements
    Given the plan is "self-hosted:oss"
    When I call getEntitlementsForPlan
    Then the entitlements should include "sso-google"
    And the entitlements should include "sso-github"
    And the entitlements should include "sso-gitlab"
    And the entitlements should not include "custom-rbac"

  # Enterprise plan entitlements
  Scenario: Enterprise plan has all entitlements
    Given the plan is "self-hosted:enterprise"
    When I call getEntitlementsForPlan
    Then the entitlements should include "sso-google"
    And the entitlements should include "sso-github"
    And the entitlements should include "sso-gitlab"
    And the entitlements should include "custom-rbac"

  # Pro plan entitlements
  Scenario: Pro plan has base entitlements but not enterprise features
    Given the plan is "self-hosted:pro"
    When I call getEntitlementsForPlan
    Then the entitlements should include "sso-google"
    And the entitlements should not include "custom-rbac"
