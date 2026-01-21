@integration
Feature: Roles UI Entitlement Gating
  As a React component
  I want to gate role management UI by entitlement
  So that OSS users see upgrade prompts

  Background:
    Given I am viewing the roles settings page
    And I have organization:manage permission

  Scenario: OSS plan shows enterprise upgrade banner
    Given publicEnv returns SELF_HOSTED_PLAN as "self-hosted:oss"
    When I render the roles settings page
    Then I should see an "Enterprise Feature" banner
    And the banner should mention "Enterprise license"
    And the banner should mention "upgrade"

  Scenario: Pro plan shows enterprise upgrade banner
    Given publicEnv returns SELF_HOSTED_PLAN as "self-hosted:pro"
    When I render the roles settings page
    Then I should see an "Enterprise Feature" banner
    And the "Create Role" button should be disabled

  Scenario: Enterprise plan shows full UI
    Given publicEnv returns SELF_HOSTED_PLAN as "self-hosted:enterprise"
    When I render the roles settings page
    Then I should NOT see an "Enterprise Feature" banner
    And the "Create Role" button should be enabled

  Scenario: Create Role button disabled without entitlement
    Given publicEnv returns SELF_HOSTED_PLAN as "self-hosted:oss"
    When I hover over the "Create Role" button
    Then I should see a tooltip explaining the enterprise requirement

  Scenario: Create Role button enabled with entitlement
    Given publicEnv returns SELF_HOSTED_PLAN as "self-hosted:enterprise"
    When I click the "Create Role" button
    Then the role creation dialog should open

  Scenario: Edit button disabled on custom role card without entitlement
    Given publicEnv returns SELF_HOSTED_PLAN as "self-hosted:oss"
    And custom roles exist in the organization
    When I view a custom role card
    Then the edit button should be disabled

  Scenario: Delete button disabled on custom role card without entitlement
    Given publicEnv returns SELF_HOSTED_PLAN as "self-hosted:oss"
    And custom roles exist in the organization
    When I view a custom role card
    Then the delete button should be disabled

  Scenario: Default roles are always viewable
    Given publicEnv returns SELF_HOSTED_PLAN as "self-hosted:oss"
    When I render the roles settings page
    Then I should see the default roles section
    And I should see Admin, Member, and Viewer roles
    And I can click to view their permissions
