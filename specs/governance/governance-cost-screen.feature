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
  Scenario: Each lane renders its own labeled total
    When a permitted viewer opens the cost screen
    Then billed, gateway, and seat amounts appear as three separately labeled figures
    And each lane's total matches its own source
    # "Never summed into one figure" is a universal negative no test can
    # prove; ADR-128 assigns it to the code-review gate in wave 1. This
    # scenario asserts the positive: three lanes, three labels, each total
    # traceable to its own lane's data.

  @integration
  Scenario: Viewing requires the organization-scoped governance cost permission
    Given a member without the governance cost permission on this organization
    # The permission is ORG-scoped (governance_cost:view). Holding it on
    # another organization, or holding project/team permissions here, must
    # not open this screen.
    When they request the cost data
    Then the request is denied

  @integration
  Scenario: The screen stays behind its release flag
    # ADR-128 names two flags: pulled-cost recording and the cost screen.
    # This scenario covers the screen flag; recording may be on while the
    # screen stays hidden.
    Given the cost screen release flag is off for the organization
    When a member opens the place the screen would live
    Then the cost screen is not shown

  @integration
  Scenario: Seat cost is seat count times the dated price, computed at read
    Given a seat type with a known count and a price effective for the period
    When the seat lane is read
    Then the amount equals the count times that price
    # ADR-128 is categorical: seat money is never materialized. No stored
    # cost row may carry a seat cost source; the multiplication happens in
    # the read path.
    And no stored cost row was created for the seat amount

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
    And no stored figure needed rewriting

  @integration
  Scenario: The seat lane shows paid seats against active seats
    # Wave-1 idle-seat requirement: the money conversation is "we pay for
    # N and use M", not just a total.
    Given the organization pays for ten seats
    And seven members were active in the period
    When the seat lane is read
    Then it shows ten seats paid and seven active

  @integration
  Scenario: A refund-heavy billed day renders negative as reported
    # Render-only in wave 1: the screen shows what the bill says, without
    # interpretation. (Deeper negative-day semantics are stamped wave 2 in
    # the ADR; flagged to the ADR owner as a deliberate scope call.)
    Given a billed day whose total is negative
    When the billed lane is read
    Then the negative amount is shown as reported
