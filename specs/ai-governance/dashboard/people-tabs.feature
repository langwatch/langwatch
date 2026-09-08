Feature: The People page is two tabs, People and Departments
  The People page under AI Governance answers two questions an admin asks
  together: who is using AI through the connected sources, and which
  department each person belongs to. It opens on a table of people ranked by
  spend and keeps the department list, its create box and the assignment
  guide on a second tab, so neither crowds the other.

  Background:
    Given the AI Governance product is enabled for the organization
    And alice is an organization admin
    And sam is a delegated viewer holding governance:view and activityMonitor:view

  @integration
  Scenario: The default tab is People
    When sam opens the People page with no tab in the address
    Then the People tab is selected
    And the table of people is requested
    And no tab parameter is written to the address

  @integration
  Scenario: The Departments tab is addressable
    When sam opens the People page with tab set to departments
    Then the Departments tab is selected
    And the department list is requested

  @integration
  Scenario: The People table renders each person with spend, requests and last activity
    Given one person used AI through a connected source in the last 30 days
    When sam opens the People page
    Then the table lists that person by name
    And the row shows their spend in dollars, their request count and when they were last active
    And the row leads to that person's detail page

  @integration
  Scenario: A person matching an organization member shows that member's department
    Given a member of the organization is assigned to the Engineering department
    And that member used AI through a connected source in the last 30 days
    When sam opens the People page
    Then the person's row shows Engineering as the department

  @integration
  Scenario: A most-used chip links to its source only when a source matches
    Given one person whose most-used target is the name of a connected source
    And one person whose most-used target matches no source
    When sam opens the People page
    Then the first person's chip links to that source's inventory page
    And the second person's chip is plain text

  @integration
  Scenario: The Departments tab keeps the create box for a manager
    When alice opens the People page with tab set to departments
    Then a compact control to create a department is offered

  @integration
  Scenario: The Departments tab offers no controls to a viewer without the manage grant
    When sam opens the People page with tab set to departments
    Then there is no control to create a department
    And the page names the governance:manage grant

  @integration
  Scenario: Enterprise-locked activity shows a quiet line, not an alert
    Given the organization's plan does not include the activity monitor
    When sam opens the People page
    Then the People tab shows a muted line saying the Enterprise plan is needed
    And no error alert is shown

  @integration
  Scenario: Nobody active in the window
    Given nobody used AI through a connected source in the last 30 days
    When sam opens the People page
    Then the People tab says no one has used AI through a connected source in the last 30 days
