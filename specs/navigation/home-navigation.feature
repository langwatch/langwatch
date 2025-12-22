@integration
Feature: Home Navigation
  As a user
  I want consistent navigation to and from the home page
  So that I can easily access the dashboard and other features

  Background:
    Given I am logged in
    And I have access to project "test-project"

  # Logo navigation
  Scenario: Logo click navigates to home page
    Given I am on the messages page
    When I click on the LangWatch logo
    Then I should be navigated to "/test-project"

  # Menu navigation
  Scenario: Home menu item navigates to home page
    Given I am on any page within the project
    When I click on "Home" in the sidebar menu
    Then I should be navigated to "/test-project"

  Scenario: Home menu item is highlighted when on home
    Given I am on the home page
    When I view the sidebar menu
    Then the "Home" menu item should be highlighted as active

  # Analytics navigation
  Scenario: Analytics menu item navigates to analytics
    Given I am on the home page
    When I click on "Analytics" in the sidebar menu
    Then I should be navigated to "/test-project/analytics"

  Scenario: Analytics menu item is highlighted when on analytics
    Given I am on the analytics page
    When I view the sidebar menu
    Then the "Analytics" menu item should be highlighted as active

  # Messages page behavior
  Scenario: Messages page shows WelcomeLayout when no traces
    Given the project has no traces (firstMessage is false)
    When I navigate to "/test-project/messages"
    Then I should see the setup/welcome layout

  Scenario: Messages page shows messages when traces exist
    Given the project has traces (firstMessage is true)
    When I navigate to "/test-project/messages"
    Then I should see the messages list

  # Analytics page behavior
  Scenario: Analytics page shows alert when no traces
    Given the project has no traces (firstMessage is false)
    When I navigate to "/test-project/analytics"
    Then I should see an alert about pending setup

  # Direct URL access
  Scenario: Can access home page directly via URL
    When I navigate directly to "/test-project"
    Then I should see the home page

  Scenario: Can access analytics page directly via URL
    When I navigate directly to "/test-project/analytics"
    Then I should see the analytics page
