@unit
Feature: License Key Validation
  As a self-hosted administrator
  I want license keys to determine my plan tier
  So that I can access features appropriate to my license

  # Plan detection from LICENSE_KEY
  Scenario: No license key returns OSS plan
    Given no LICENSE_KEY environment variable is set
    When I call getSelfHostedPlan
    Then the plan should be "self-hosted:oss"

  Scenario: Enterprise license key returns enterprise plan
    Given LICENSE_KEY is set to "LW-ENT-abc123"
    When I call getSelfHostedPlan
    Then the plan should be "self-hosted:enterprise"

  Scenario: Pro license key returns pro plan
    Given LICENSE_KEY is set to "LW-PRO-xyz789"
    When I call getSelfHostedPlan
    Then the plan should be "self-hosted:pro"

  Scenario: Invalid license key falls back to OSS plan
    Given LICENSE_KEY is set to "invalid-key-format"
    When I call getSelfHostedPlan
    Then the plan should be "self-hosted:oss"

  # Helper functions
  Scenario: isEeEnabled returns true for enterprise plan
    Given LICENSE_KEY is set to "LW-ENT-test"
    When I call isEeEnabled
    Then it should return true

  Scenario: isEeEnabled returns false for OSS plan
    Given no LICENSE_KEY environment variable is set
    When I call isEeEnabled
    Then it should return false

  Scenario: hasPaidLicense returns true for pro or enterprise
    Given LICENSE_KEY is set to "LW-PRO-test"
    When I call hasPaidLicense
    Then it should return true
