Feature: Usage page
  The Usage page shows what an organization used this month against what its plan
  includes: the plan and its next step, the month's events day by day, each project's
  share and the seats in use. Plan & billing is where the plan is changed and paid.

  Background:
    Given I am logged in as an organization admin on the hosted product

  # Navigation names

  @unit
  Scenario: The settings menu names the two billing pages Usage and Plan & billing
    When I open the settings menu on the hosted product
    Then I see "Usage" linking to /settings/usage
    And I see "Plan & billing" linking to /settings/subscription

  # Plan strip

  @integration
  Scenario: A Free organization sees its plan and the upgrade on top
    Given the organization is on the Free plan with 50,000 events and 2 full seats a month
    When I open the Usage page
    Then the plan strip reads "Free plan" with a "Current" chip
    And it reads "€0 · 50,000 events and 2 full seats a month"
    And "Upgrade to Growth" opens the Growth seat dialog on Plan & billing

  @integration
  Scenario: A Growth organization sees its price and manages its subscription
    Given the organization is on Growth with 3 full seats billed monthly in euros
    When I open the Usage page
    Then the plan strip reads "Growth plan" and the monthly price for 3 full seats, excl. VAT
    And "Manage subscription" opens Plan & billing

  # The month

  @integration
  Scenario: Events this month are shown against the allowance, day by day
    Given the organization sent 31,800 events this month on a 50,000 allowance
    When I open the Usage page
    Then "Events this month" reads "31,800" "of 50,000 included" with a meter
    And a bar is drawn for each day of the month
    And it says when the count resets

  @integration
  Scenario: A Growth organization sees the overage price instead of a meter
    Given the organization is on Growth
    When I open the Usage page
    Then "Events this month" reads "200,000 included, then €5 per 100,000"
    And no meter is drawn

  @integration
  Scenario: A new organization with no events is pointed at tracing setup
    Given the organization sent no events this month
    When I open the Usage page
    Then I see "No events yet this month. Send your first trace and it shows up here."
    And a "Set up tracing" link
    And no "By project" section

  @integration
  Scenario: The page says when the month's events cannot be read
    Given the usage store cannot answer
    When I open the Usage page
    Then the events card says the count could not be loaded
    And no empty state claims the organization sent nothing

  # By project

  @integration
  Scenario: Each project's share of the month is listed, the busiest first
    Given "support-agent" sent 19,800 events, "triage" 8,200 and "content" 3,800 this month
    And "archive" sent none
    When I open the Usage page
    Then "By project" lists support-agent, triage and content in that order with their counts
    And "archive" is not listed

  @integration
  Scenario: A member who does not administer the organization sees the month without the breakdown
    Given I am a member without organization:manage
    When I open the Usage page
    Then "Events this month" shows the count and the meter
    And no daily bars and no "By project" section are shown
    And nothing says the count could not be loaded

  # Seats

  @integration
  Scenario: Full seats in use are shown against the plan with a link to Users
    Given 1 of the 2 full seats on the plan is taken
    When I open the Usage page
    Then the Seats card reads "1 / 2" full seats
    And "Manage in Users" opens /settings/members

  @integration
  Scenario: Free explains Lite members instead of counting zero of zero
    Given the organization is on the Free plan
    When I open the Usage page
    Then the Lite members row reads "Lite members come with Growth, read only, free and unlimited."
    And it does not read "0 / 0"

  @integration
  Scenario: A plan without Lite seats shows no Lite row
    Given the organization is on a legacy tiered paid plan
    When I open the Usage page
    Then the Seats card has no Lite members row

  # The month breakdown read

  @unit
  Scenario: The month breakdown counts each day and each project of an events-metered organization
    Given an events-metered organization with two named projects and events on three days this month
    When the month breakdown is read
    Then every day of the month is answered, the three days with their counts and the rest with zero
    And each project with events is answered with its name and count, the busiest first
    And the reset date is the first day of next month

  @unit
  Scenario: A trace-metered organization gets no daily series
    Given an organization metered in traces
    When the month breakdown is read
    Then it answers no daily series
    And it still answers each project's count

  @unit
  Scenario: Only organization administrators read the month breakdown
    When the month breakdown route is declared
    Then it asks "organization:manage" of the organization, the audience of the limit email
