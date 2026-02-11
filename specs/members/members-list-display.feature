@unit
Feature: Members List Display
  As a LangWatch organization admin
  I want to see member roles with visual distinction and invitation links directly in the table
  So that I can quickly identify member types and share invitation links

  Scenario: Role column displays color-coded role labels
    Given I am on the members page
    When I view the members list
    Then Admin and Member roles display with color-coded role labels
    And Lite Member role displays with a distinct color-coded role label

  Scenario: Invite link is visible in pending invites table
    Given there are pending invites
    When I view the pending invites table
    Then I see an "Invite Link" column with copyable links
