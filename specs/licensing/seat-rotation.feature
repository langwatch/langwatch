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
    Scenario: Moving a Developer to Lite Member needs a free Lite Member seat
      Given every Lite Member seat is in use
      And "Dev" is a Developer
      When an administrator changes "Dev" to a Lite Member
      Then the change is refused for want of a Lite Member seat

    @unit
    Scenario: Re-enabling a Lite Member asks for a Lite Member seat
      Given "Lia" is a disabled Lite Member
      When an administrator re-enables "Lia"
      Then the Lite Member seats are checked, not the full member seats

    @unit
    Scenario: Re-enabling a Developer is never refused for seats
      Given "Dev" is a disabled Developer
      When an administrator re-enables "Dev"
      Then no capped seat is checked

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

    @integration
    Scenario: A removed person with a held seat is listed as Deactivated
      Given "Bar" was removed with a seat held until 3 December
      When an administrator opens Users
      Then "Bar" is listed greyed out after the members, with "Deactivated, seat frees 3 Dec"
      And the list offers no actions on "Bar"

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
    Scenario: A person waiting for a seat is listed as waiting, not disabled
      Given "Qux" is waiting for a full member seat
      When an administrator opens Users
      Then "Qux" carries the chip "Waiting for a seat" among the members
      And the Waiting to join cut does not count "Qux" a second time

    # One model: the person waiting is their held membership row plus their open seat request
    # (modules/organization/specs/seat-requests.feature), listed once in the seat requests card.
    @integration
    Scenario: A person given a seat while waiting has their seat request closed
      Given "Qux" is waiting for a full member seat with an open seat request
      And a full member seat is free
      When "Qux" is given the seat, by an administrator or by the hourly seat hold check
      Then "Qux" is a full member with access
      And the seat request of "Qux" is approved and no longer listed

    @unit
    Scenario: A person the directory pushes while every seat is taken opens a seat request
      Given 5 of 5 full member seats are in use and no Lite seat is free
      When the identity provider pushes "Qux" into the organization
      Then "Qux" is waiting for a full member seat
      And "Qux" has an open seat request

    @integration
    Scenario: A person waiting for a seat can be given one from their row
      Given "Qux" is waiting for a full member seat
      When an administrator chooses "Give them a seat" on the row of "Qux"
      Then "Qux" is enabled

    @integration
    Scenario: Enabling a person waiting for a seat admits them
      Given "Bar" took their seat 45 days ago
      And "Qux" is waiting for a full member seat
      When an administrator removes "Bar"
      And the administrator enables "Qux"
      Then "Qux" is a full member with access

    @integration
    Scenario: Enabling a person waiting for a seat is refused while no full seat fits
      Given 5 of 5 full member seats are in use and Lite seats are free
      And "Qux" is waiting for a full member seat
      When an administrator enables "Qux"
      Then the enable is refused because every full member seat is taken
      And "Qux" is still waiting

    @integration
    Scenario: A failed seat handover still removes the member
      Given "Bar" took their seat 45 days ago
      And "Qux" is waiting for a full member seat
      When an administrator removes "Bar", gives the seat to "Qux" and giving it fails
      Then "Bar" is removed
      And "Qux" is still waiting
      And the administrator reads "Member removed. Their seat did not go to the person waiting: enable them in Users to give it."

    @integration
    Scenario: A seat handover whose grant fails after the enable still gives the seat
      Given "Bar" took their seat 45 days ago
      And "Qux" is waiting for a full member seat
      When an administrator removes "Bar", gives the seat to "Qux" and writing the grant of "Qux" fails
      Then "Bar" is removed
      And "Qux" is enabled and no longer waiting
      And the answer names "Qux" as given the seat, with no failed handover

    @integration
    Scenario: A seat handover whose admission cannot be completed still gives the seat
      Given "Bar" took their seat 45 days ago
      And "Qux" is waiting for a full member seat
      When an administrator removes "Bar", gives the seat to "Qux" and completing the admission of "Qux" fails
      Then "Qux" is enabled and no longer waiting
      And the answer names "Qux" as given the seat, with no failed handover

    @integration
    Scenario: The seat hold check finishes an admission whose grant failed
      Given "Qux" was given a seat and writing their grant failed
      When the seat hold check runs
      Then "Qux" gets their member grant
      And their admission is completed

    @integration
    Scenario: A role change whose grants fail keeps the seat as it was
      Given "Bar" took their seat on 3 November
      When an administrator changes the role of "Bar" and writing the grants fails
      Then "Bar" keeps their role, their seat date and any hold they had

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

    @integration
    Scenario: A seat hold check that fails in one organization retries it and admits in the others
      Given holds ended in two organizations with someone waiting in each
      And admitting in the first organization fails
      When the seat hold check runs
      Then the person waiting in the second organization is a full member with access
      And the person waiting in the first organization is still waiting
      When the seat hold check runs again and admitting works
      Then the person waiting in the first organization is a full member with access

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

    @integration
    Scenario: Removing a person without a full seat offers no seat
      Given "Bar" is a Lite Member
      And "Qux" is waiting for a full member seat
      When an administrator opens the remove dialog for "Bar"
      Then they read "They lose access to everything in it."
      And no seat is offered to "Qux"
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

    @unit
    Scenario: A refused charge after a lift puts the seat line back
      Given an organization lowered its seats from 5 to 3 and keeps 5 until the period ends
      When an administrator raises the seats to 6 and the payment provider refuses the charge
      Then the seat line is put back to 3 seats with no proration

    @unit
    Scenario: A seat line Stripe refused to put back is recorded for repair
      Given an organization lowered its seats from 5 to 3 and keeps 5 until the period ends
      When an administrator raises the seats to 6 and the payment provider refuses the charge
      And the payment provider also refuses putting the seat line back
      Then the subscription records that Stripe should bill 3 seats

    @unit
    Scenario: A seat change records the repair before it lifts the seat line
      Given an organization lowered its seats from 5 to 3 and keeps 5 until the period ends
      When an administrator raises the seats to 6
      Then the subscription records that Stripe should bill 3 seats, lifted to 5, before the lift is sent
      And the record is cleared once the change completes

    @unit
    Scenario: A seat change whose repair cannot be recorded leaves Stripe alone
      Given an organization lowered its seats from 5 to 3 and keeps 5 until the period ends
      When an administrator raises the seats to 6 and recording the repair fails
      Then the change errors
      And the payment provider is not asked to change anything

    @unit
    Scenario: A seat line left lifted by a stopped change is put back
      Given a seat change recorded that Stripe should bill 3 seats, lifted to 5, and stopped after the lift
      And the record is older than the grace window
      When the seat line repair runs
      Then the payment provider changes the quantity to 3 with no proration
      And the repair is cleared

    @unit
    Scenario: A seat line repair waits out a change that may still be running
      Given a seat change recorded that Stripe should bill 3 seats, lifted to 5, a minute ago
      When the seat line repair runs
      Then the payment provider is not asked anything
      And the repair stays pending

    @unit
    Scenario: A seat line at the charged count clears its repair without a change
      Given the subscription records that Stripe should bill 3 seats, lifted to 5
      And Stripe bills 6 seats because the charge went through before the change stopped
      When the seat line repair runs
      Then the payment provider is not asked to change anything
      And the repair is cleared

    @unit
    Scenario: A seat line a later change moved is left alone
      Given the subscription records that Stripe should bill 3 seats, lifted to 5
      And a later change made Stripe bill 4 seats
      When the seat line repair runs
      Then the payment provider is not asked to change anything
      And the repair is cleared

    @unit
    Scenario: A seat change waits for a seat line repair on the same subscription
      Given the subscription records that Stripe should bill 3 seats while Stripe bills 5
      And the seat line repair has read Stripe and not yet moved the line
      When an administrator raises the seats to 6
      Then the seat change starts only after the repair finished
      And Stripe ends at 6 seats

    @unit
    Scenario: A seat line repair skips a subscription a seat change is working on
      Given the subscription records that Stripe should bill 3 seats while Stripe bills 5
      And a seat change is working on the subscription
      When the seat line repair runs
      Then the payment provider is not asked anything
      And the repair stays pending for the next pass

    @unit
    Scenario: A seat change that waited plans from the seats as the change before it left them
      Given an administrator lowers the seats from 5 to 3 while another raise to 4 waits behind it
      When the raise to 4 runs
      Then it reads the 5 kept seats the decrease recorded
      And the payment provider changes the quantity to 4 with no proration

    @unit
    Scenario: A seat line repair whose lease ran out and was taken over does not write
      Given the subscription records that Stripe should bill 3 seats while Stripe bills 5
      And the seat line repair read Stripe, then its lease ran out and a seat change took it
      When the seat line repair goes on
      Then the payment provider is not asked to change anything
      And the repair stays pending for the next pass

    @unit
    Scenario: A seat line write that lands after a seat change took its lease is put right
      Given the subscription records that Stripe should bill 3 seats while Stripe bills 5
      And the seat line repair renewed its lease and sent its write, which stalls
      And the lease ran out and a seat change raised the seats to 6 meanwhile
      When the repair's write lands and Stripe shows 3 seats
      Then the repair is not counted as repaired
      And the subscription still records the write the repair sent
      When the seat line repair runs after the grace window
      Then the payment provider changes the quantity to 6 with no proration
      And no seat line write is left pending

    @unit
    Scenario: A database outage right after a Stripe write still leaves a repair that runs
      Given an organization with 5 seats
      When an administrator lowers the seats to 3, Stripe takes the write and the database refuses clearing it
      Then the change errors
      And the subscription still records the write of 3 seats
      When the seat line repair runs after the grace window
      Then the payment provider is not asked to change anything
      And the seat line quantity is 3 and no seat line write is left pending

    @unit
    Scenario: A seat line write the database refuses to record ahead is never sent
      Given an organization with 5 seats
      When an administrator raises the seats to 6 and recording the write ahead fails
      Then the change errors
      And the payment provider is not asked to change anything

    @integration
    Scenario: The seat line quantity a pending write settles to ignores the provider's own updates
      Given a seat change set the seats to 6
      And a provider update event then reported 3 seats
      Then the seat line quantity the repair settles to is still 6
      And a write recorded ahead stays pending until it is cleared by the write that opened it

    @unit
    Scenario: Seat line writes give up well inside the lease
      Given the subscription records that Stripe should bill 3 seats while Stripe bills 5
      When the seat line repair and then a seat change move the line
      Then every Stripe seat line write carries a request timeout of one minute
      And two attempts at that timeout fit inside the five minute lease

    @unit
    Scenario: A seat change refused while another one keeps running
      Given a seat change is working on the subscription and does not finish
      When an administrator raises the seats
      Then the change is refused with "seat_change_busy"
      And the payment provider is not asked to change anything

    @unit
    Scenario: A seat line repair moves the line on a past due subscription
      Given the subscription records that Stripe should bill 3 seats while Stripe bills 5
      And the subscription is past due at Stripe
      When the seat line repair runs
      Then the payment provider changes the quantity to 3 with no proration
      And the repair is cleared

    @unit
    Scenario: A seat line repair stays pending while Stripe cannot change the subscription
      Given the subscription records that Stripe should bill 3 seats while Stripe bills 5
      And the subscription is incomplete at Stripe
      When the seat line repair runs
      Then the payment provider is not asked to change anything
      And the repair stays pending for the next pass

    @unit
    Scenario: A seat line repair on a canceled subscription is cleared
      Given the subscription records that Stripe should bill 3 seats while Stripe bills 5
      And the subscription is canceled at Stripe
      When the seat line repair runs
      Then the payment provider is not asked to change anything
      And the repair is cleared

    @unit
    Scenario: A seat line Stripe refused to put back is repaired later
      Given the subscription records that Stripe should bill 3 seats while Stripe bills 5
      When the seat line repair runs
      Then the payment provider changes the quantity to 3 with no proration
      And the repair is cleared

    @unit
    Scenario: A seat line Stripe already bills right clears its repair without a change
      Given the subscription records that Stripe should bill 3 seats and Stripe bills 3
      When the seat line repair runs
      Then the payment provider is not asked to change anything
      And the repair is cleared

    @unit
    Scenario: A later seat change replaces a pending repair
      Given the subscription records that Stripe should bill 3 seats
      When an administrator changes the seats and the payment provider accepts it
      Then the repair is cleared

    @unit
    Scenario: A seat line still wrong after retries is flagged to Ops
      Given the subscription records that Stripe should bill 3 seats
      When the seat line repair is refused 5 times
      Then the subscription is flagged as needing a seat line repair
      And the next repair that succeeds clears the flag

    @integration
    Scenario: Ops sees which subscriptions need a seat line repair
      Given a subscription is flagged as needing a seat line repair to 3 seats
      When an operator opens the Ops subscriptions list
      Then its row reads "Seat line needs repair: 3 seats"

    @unit
    Scenario: The seat line repair runs every 15 minutes
      When the seat line repair process wakes
      Then it asks billing for one repair pass

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

    @integration
    Scenario: A seat change the payment provider refuses sends no invitations
      Given an administrator typed an address into the seat drawer and added a seat
      When the payment provider refuses the seat change
      Then no invitation is sent
      And the seat drawer stays open with the address

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
