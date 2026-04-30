Feature: Workflow Publish Is Not Gated By Subscription Or License
  As a LangWatch user (free, paid, self-hosted, or licensed)
  I want to publish my workflows without hitting an "upgrade to publish" wall
  So that I can use the platform end-to-end without artificial blockers

  Resource count limits (max workflows, max evaluators, max projects) still
  apply at creation time and are the right place to surface plan limits.
  The Publish action itself is no longer gated — once a user has gotten a
  workflow into the studio, they can publish it.

  Background:
    Given I am authenticated as a project member
    And I have a workflow open in the optimization studio

  @integration
  Scenario: Free SaaS user can open the publish menu without a paywall
    Given my organization is on the FREE plan
    When I click the "Publish" button
    Then the dropdown shows "Publish workflow", "View API Reference" and "Export Workflow"
    And no menu item shows a lock icon
    And no menu item shows a "Subscribe to unlock publishing" tooltip

  @integration
  Scenario: Self-hosted user without a paid license can open the publish menu without a paywall
    Given the platform is deployed in self-hosted mode
    And no paid license is installed (FREE_PLAN fallback)
    When I click the "Publish" button
    Then the dropdown shows the publish menu items
    And no menu item redirects to "/settings/license" on click
    And no menu item shows a lock icon

  @integration
  Scenario: Paid SaaS user can publish without a paywall (regression)
    Given my organization is on a paid plan
    When I click the "Publish" button
    Then the dropdown shows the publish menu items with no lock icon

  @unit
  Scenario: Publish.tsx does not query plan.canPublish to gate the menu
    Given the Publish component renders
    Then it must not read activePlan.canPublish to disable or hide menu items
    And it must not render a lock-icon menu item that redirects to plan management

  @integration
  Scenario: Workflow creation count limits still apply
    Given my organization has reached the maximum number of workflows
    When I try to create a new workflow
    Then I see the workflow count limit blocker
    And the upgrade link redirects to plan management
    # The publish gate removal does NOT remove resource count limits.
