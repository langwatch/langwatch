Feature: Navigation destinations that live inside a project
  As someone who just signed up
  I want the sidebar to tell me the truth about where it can take me
  So that I never click something that throws me out of the product

  Most of the sidebar leads to a place inside a project: Home, Analytics,
  Traces, Prompts, and so on. Some signups do not get a project, so those
  destinations have nowhere to go yet. An item with nowhere to go is shown
  dimmed and inert with the reason on it, not pointed at some other page. The
  items that do not need a project, like Settings, keep working.

  Background:
    Given I am signed in

  @integration
  Scenario: A destination inside a project says why it cannot be opened
    Given my organization has no project
    When I look at the sidebar
    Then "Analytics" is shown as unavailable
    And hovering it reads "Create a project first to open Analytics."
    And it is not a link to anywhere

  @integration
  Scenario: No destination sends a signed-in person to sign in again
    Given my organization has no project
    When I look at the sidebar
    Then no item in it links to the sign-in page

  @integration
  Scenario: Destinations that do not need a project keep working
    Given my organization has no project
    When I look at the sidebar
    Then "Settings" still opens the settings page

  @integration
  Scenario: Grouped destinations follow the same rule
    Given my organization has no project
    When I expand "Simulations"
    Then "Scenarios" and "Runs" are both shown as unavailable
    And the group renders without a React key warning

  @integration
  Scenario: With a project, every destination opens inside it
    Given my organization has a project "demo"
    When I look at the sidebar
    Then "Home" opens "/demo"
    And "Analytics" opens "/demo/analytics"
    And nothing in the sidebar is marked unavailable
