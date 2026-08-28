@governance @cost
Feature: One cost screen, three honest lanes
  Wave 1 shows what the provider billed, what the gateway metered, and what
  the seats cost — side by side, each labeled for what it is, never summed
  into one figure. Seat money is arithmetic done at read time from a dated
  price list, so a wrong price fixed once heals every screen. The screen is
  visible only to organization members with the governance cost permission,
  and stays behind release flags until it is ready.
  Decision: ADR-128.

  Background:
    Given an organization with billed, gateway, and seat cost available

  @integration
  Scenario: The lanes render side by side, never summed
    When a permitted viewer opens the cost screen
    Then billed, gateway, and seat amounts appear as separate labeled figures
    And no single figure combines two lanes

  @integration
  Scenario: Viewing requires the organization-scoped governance cost permission
    Given a member without the governance cost permission
    When they request the cost data
    Then the request is denied

  @integration
  Scenario: The screen stays behind its release flag
    Given the release flag is off for the organization
    When a member opens the place the screen would live
    Then the cost screen is not shown

  @integration
  Scenario: Seat cost is seat count times the dated price, computed at read
    Given a seat type with a known count and a price effective for the period
    When the seat lane is read
    Then the amount equals the count times that price

  @integration
  Scenario: A seat type without a price is shown as unpriced, never zero
    Given a seat type with a count but no price for the period
    When the seat lane is read
    Then it shows the seat count and says the price is missing
    And it does not show zero cost

  @integration
  Scenario: Fixing a wrong seat price heals every screen
    Given seat cost was read with a wrong price
    When the price for that period is corrected
    Then every subsequent read shows the corrected amount

  @integration
  Scenario: A refund-heavy billed day renders negative as reported
    Given a billed day whose total is negative
    When the billed lane is read
    Then the negative amount is shown as reported
