Feature: Seat rotation
  People can be rotated through an organization's seats on every plan. Removing someone takes
  their access at once; their full seat stays counted until 30 days after they took it, and frees
  at once if they held it longer. The same rule holds on Stripe Growth, on contract and AWS
  Marketplace plans and on self-hosted licences, because they all count seats the same way.

  Background:
    Given an organization "ACME" with 5 full member seats, all in use
    And "Bar" holds a full member seat

  Rule: a removed or disabled full member's seat is held until 30 days after they took it
    The seat is taken when the membership starts holding a full seat: joining as a full member,
    a Lite Member promoted to full, or a disabled member enabled again. A hold keeps that date,
    so a person who comes back within the hold reuses the held seat rather than taking a second one.

    @integration
    Scenario: Removing someone who took their seat over 30 days ago frees it at once
      Given "Bar" took their seat 45 days ago
      When an administrator removes "Bar"
      Then "Bar" has no access to "ACME"
      And 4 of 5 full member seats are in use
      And "Bar" is not listed in Users

    @integration
    Scenario: Removing someone who took their seat under 30 days ago holds it until 30 days after
      Given "Bar" took their seat 3 days ago
      When an administrator removes "Bar"
      Then "Bar" has no access to "ACME"
      And 5 of 5 full member seats are in use
      And "Bar" is listed in Users as "Deactivated, seat frees" on the day 30 days after they took it

    @integration
    Scenario: Disabling a full member holds their seat the same way
      Given "Bar" took their seat 3 days ago
      When an administrator disables "Bar"
      Then "Bar" has no access to "ACME"
      And 5 of 5 full member seats are in use

    @integration
    Scenario: Demoting a full member to Lite holds their full seat the same way
      Given "Bar" took their seat 3 days ago
      And a Lite Member seat is free
      When an administrator changes "Bar" to a Lite Member
      Then 5 of 5 full member seats are in use

    @integration
    Scenario: A held seat frees on its own when the hold ends
      Given "Bar" was removed with a seat held until yesterday
      Then 4 of 5 full member seats are in use
      And "Bar" is not listed in Users

    @integration
    Scenario: A person added back within their hold reuses the held seat
      Given "Bar" was removed with a seat held until 10 days from now
      When "Bar" is added back as a full member
      Then 5 of 5 full member seats are in use
      And "Bar" took their seat on the original day

    @integration
    Scenario: A pending invitation that is revoked frees its seat at once
      Given an invitation for "new@acme.example" as a full member is pending
      When an administrator revokes the invitation
      Then the invitation holds no seat

    @unit
    Scenario: Demoting a full member is never refused because the Lite Member seats are full
      Given every Lite Member seat is in use
      When an administrator changes "Bar" to a Lite Member
      Then the change goes through

    @unit
    Scenario: A directory offboarding keeps the seat as a manual removal does
      Given "Bar" took their seat 3 days ago
      When the identity provider deprovisions "Bar"
      Then the seat is held before the directory takes "Bar"'s membership away

    @unit
    Scenario: A directory offboarding that cannot keep the seat removes nobody
      Given the seat hold for "Bar" cannot be written
      When the identity provider deprovisions "Bar"
      Then "Bar" keeps their access
      And the push is recorded as failed so the directory retries it

    @integration
    Scenario: Unassigning and reassigning someone in the identity provider reuses their held seat
      Given "Bar" took their seat 3 days ago
      When the identity provider deprovisions "Bar"
      Then 5 of 5 full member seats are in use
      When the identity provider provisions "Bar" again
      Then 5 of 5 full member seats are in use
      And "Bar" took their seat on the original day

    @unit
    Scenario: A person provisioned again by the directory within their hold takes the held seat
      Given every full member seat is in use, one of them held for "Bar"
      When the identity provider provisions "Bar" again
      Then "Bar" joins as a full member, not waiting for a seat

    @unit
    Scenario: A seat held for someone else is not given to a newcomer
      Given every full member seat is in use, one of them held for "Bar"
      When the identity provider provisions "Qux"
      Then "Qux" waits for a seat

    @unit
    Scenario: Inviting back a person within their hold needs no free seat
      Given "Bar" was removed with a seat held until 10 days from now
      When an administrator invites "Bar" again as a full member
      Then the invitation goes through

    @unit
    Scenario: Inviting someone else while every seat is held is refused
      Given "Bar" was removed with a seat held until 10 days from now
      When an administrator invites "new@acme.example" as a full member
      Then the invitation is refused with "member_seat_limit_reached"

    @integration
    Scenario: A person who accepts an invitation within their hold takes the held seat
      Given "Bar" was removed with a seat held until 10 days from now
      And an invitation for "Bar" as a full member is pending
      Then 5 of 5 full member seats are in use
      When "Bar" accepts the invitation
      Then 5 of 5 full member seats are in use
      And "Bar" took their seat on the original day

    @integration
    Scenario: A person who comes back as a Lite Member leaves the full seat held
      Given "Bar" was removed with a seat held until 10 days from now
      When "Bar" is added back as a Lite Member
      Then 5 of 5 full member seats are in use
      And "Bar" is listed in Users as "Deactivated, seat frees" on the original day 30 days later

  Rule: a seat that frees goes to whoever is waiting

    @integration
    Scenario: The removal of a long-held seat offers it to the person waiting
      Given "Bar" took their seat 45 days ago
      And "Qux" is waiting for a full member seat
      When an administrator removes "Bar" and gives the seat to "Qux"
      Then "Qux" is a full member with access
      And 5 of 5 full member seats are in use

    @integration
    Scenario: The removal can leave the freed seat empty
      Given "Bar" took their seat 45 days ago
      And "Qux" is waiting for a full member seat
      When an administrator removes "Bar" without giving the seat away
      Then "Qux" is still waiting
      And 4 of 5 full member seats are in use

    @integration
    Scenario: A hold that ends admits the person waiting longest
      Given "Bar" was removed with a seat held until an hour ago
      And "Qux" has waited for a full member seat longer than "Quux"
      When the seat hold check runs
      Then "Qux" is a full member with access
      And "Quux" is still waiting

    @integration
    Scenario: A hold that ends with nobody waiting just frees the seat
      Given "Bar" was removed with a seat held until an hour ago
      And nobody is waiting for a seat
      When the seat hold check runs
      Then 4 of 5 full member seats are in use

  Rule: the remove dialog says what happens to the seat
    Never suggest removing someone to free a seat.

    @integration
    Scenario: Removing a long-held seat with someone waiting
      Given "Bar" took their seat 45 days ago
      And "Qux" is waiting for a full member seat
      When an administrator opens the remove dialog for "Bar"
      Then they read "Their seat frees up right away."
      And they read "Qux is waiting for a seat. Give them this seat?" with the box ticked
      And the button reads "Remove and give the seat to Qux"

    @integration
    Scenario: Removing a recent seat
      Given "Bar" took their seat on 3 November
      When an administrator opens the remove dialog for "Bar"
      Then they read "They lose access now. Their seat stays taken until 3 Dec, 30 days after they joined."
      And the button reads "Remove"

  Rule: Stripe Growth adds seats now, prorated, and lowers them from the next cycle
    Lowering keeps the seats paid for until the period ends, with no credit for the rest of it.
    The server never lowers below the full seats in use plus the seats held.

    @unit
    Scenario: Adding seats charges the prorated amount now
      When an administrator raises the seats from 5 to 6
      Then the payment provider invoices the prorated difference at once
      And 6 full member seats are available at once

    @unit
    Scenario: Lowering seats applies from the next billing cycle
      Given 3 full member seats are in use
      When an administrator lowers the seats from 5 to 3
      Then the payment provider changes the quantity with no proration
      And 5 full member seats stay available until the period ends
      And 3 full member seats are available from the next period

    @unit
    Scenario: Lowering below the seats in use and held is refused
      Given 3 full member seats are in use and 1 seat is held
      When an administrator lowers the seats from 5 to 3
      Then the change is refused with "seat_quantity_below_in_use" and a minimum of 4

    @unit
    Scenario: Adding seats on a legacy tiered subscription is prorated now
      Given the organization is on a legacy tiered subscription
      When an administrator raises the seats
      Then the payment provider invoices the prorated difference at once

    @integration
    Scenario: The seat drawer explains a lower count
      When an administrator sets the seats from 5 to 3 in the seat drawer
      Then they read "You'll keep 5 seats until 1 Dec, then pay for 3. No refund for the rest of this month."
      And the button reads "Lower to 3 seats"

    @integration
    Scenario: The seat drawer explains an added seat
      When an administrator sets the seats from 5 to 6 in the seat drawer
      Then they read the prorated amount due today and the new monthly price
      And the button reads "Add 1 seat"

    @integration
    Scenario: During a lowered period the seat drawer starts from the billed seats
      Given an organization lowered its seats from 5 to 3 and keeps 5 until 1 Dec
      When an administrator adds one seat in the seat drawer
      Then the summary reads "Seats 3 → 4" with nothing due today
      And the button reads "Add 1 seat"

  Rule: contract, AWS Marketplace and licence seats are fixed until renewal

    @integration
    Scenario: A contract plan shows its seats without a seat drawer
      Given the organization is on a contract for 50 seats
      When an administrator opens the plan page
      Then they read "Your contract covers 50 seats. Contact LangWatch to add more."
      And there is a "Contact us" link and no way to change the seats

    @integration
    Scenario: A self-hosted licence shows its seats without a seat drawer
      Given the deployment runs on a licence for 25 seats
      When an administrator opens the plan page
      Then they read "Your licence covers 25 seats. Contact LangWatch to add more."
