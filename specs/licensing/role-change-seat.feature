Feature: Adding a seat with a role change
  An administrator moves a member to a role that needs a full seat while every full seat is in
  use. The member drawer offers one more seat in place, priced before anything is charged, and one
  button buys the seat and changes the role together. A seat is charged to the subscription's
  payment method like a renewal. When the customer must act first (a declined or 3D Secure
  charge, or a plan that has no Stripe subscription yet), the payment page opens and the role
  changes once it is paid, exactly once. A refused change charges nothing.

  Background:
    Given an organization "ACME" on LangWatch Cloud on Growth, billed at $34 a full seat a month
    And "ACME" pays for 2 full seats and both are in use
    And "Sam" is a Lite Member of "ACME"
    And I am an administrator of "ACME"

  Rule: the change is validated before any charge

    @unit
    Scenario: A role change refused for another reason charges nothing
      Given the change of "Sam" to Admin is refused for a reason other than the seat limit
      When I add a seat and make "Sam" an Admin
      Then the refusal is answered by name
      And no seat is added and nothing is charged

    @unit
    Scenario: A free full seat is used without a charge
      Given "ACME" pays for 3 full seats and 2 are in use
      When I add a seat and make "Sam" an Admin
      Then "Sam" is an Admin
      And no seat is added and nothing is charged

  Rule: one click adds the seat and changes the role

    @unit
    Scenario: One click charges the seat and makes the member an Admin
      When I add a seat and make "Sam" an Admin
      Then the new seat is billed now, prorated, on an invoice of its own
      And once that invoice is paid one full seat is added to the subscription with no second charge
      And "Sam" is an Admin
      And the answer says the role changed and a seat was added

    @unit
    Scenario: The seat offer prices one more seat before anything is charged
      When I read the seat offer for "ACME"
      Then it prices 3 full seats: the seat price, today's prorated amount and the new total
      And it names the day the next period starts
      And nothing is charged

    @unit
    Scenario: A plan without paid seats has no seat offer
      Given "ACME" is on the Free plan
      When I read the seat offer for "ACME"
      Then there is no seat offer and the upgrade path applies

  Rule: a payment the customer must finish applies once it is paid, exactly once

    @unit
    Scenario: A charge needing the customer opens the seat invoice and changes nothing yet
      Given the charge for the new seat needs 3D Secure
      When I add a seat and make "Sam" an Admin
      Then the answer is the seat invoice's payment page
      And "Sam" is still a Lite Member
      And the subscription still bills 2 full seats
      And the seat invoice bills the seat alone, none of the period's usage

    @integration
    Scenario: An unpaid seat invoice never takes the period's usage
      Given a subscription with two seats and metered usage this period
      And the charge for the new seat needs 3D Secure
      When I add a seat and the seat invoice is left unpaid until it lapses
      Then the subscription still bills 2 full seats
      And the renewal invoice bills the period's usage in full

    @unit
    Scenario: The paid invoice applies the change, then the return changes nothing
      Given "Sam" waits to become an Admin on an unpaid seat invoice
      When the seat invoice is paid
      And billing records that the seat invoice was paid
      And I come back to the member drawer
      Then "Sam" is an Admin
      And the change was applied once

    @unit
    Scenario: The return applies the change, then the paid fact changes nothing
      Given "Sam" waits to become an Admin on an unpaid seat invoice
      When the seat invoice is paid
      And I come back to the member drawer
      And billing records that the seat invoice was paid
      Then "Sam" is an Admin
      And the change was applied once

    @unit
    Scenario: An unpaid seat invoice keeps the change waiting
      Given "Sam" waits to become an Admin on an unpaid seat invoice
      When I come back to the member drawer
      Then the change is still waiting
      And "Sam" is still a Lite Member

    @unit
    Scenario: A failed or abandoned payment changes nothing
      Given "Sam" waits to become an Admin on a seat invoice that was voided
      When I come back to the member drawer
      Then the change has failed
      And "Sam" is still a Lite Member
      And the subscription still bills 2 full seats

    @unit
    Scenario: A plan with no Stripe subscription buys the seat through checkout
      Given the only plan of "ACME" was added by an operator and has no Stripe subscription
      When I add a seat and make "Sam" an Admin
      Then a seat checkout opens for 3 full seats and returns to the members page
      And "Sam" becomes an Admin once that checkout is paid, exactly once

  Rule: concurrent and repeated purchases buy exactly what was asked

    @unit
    Scenario: Two promotions of one member at once buy one seat
      Given ACME uses every full seat it pays for
      When an admin double-clicks "Make Admin" for "Sam", or asks from two tabs at once
      Then one seat is bought, "Sam" becomes an Admin, and the second request finds the seat taken by "Sam"

    @unit
    Scenario: Two seat purchases at once buy two seats
      Given another seat purchase for "ACME" lands while mine waits for the seat line
      When I add a seat and make "Sam" an Admin
      Then my purchase reads the seat line again once it holds it
      And it raises the line by one more seat than the other purchase left

    @unit
    Scenario: A purchase while a seat payment waits reopens that payment
      Given "Sam" waits to become an Admin on an unpaid seat invoice
      When I add a seat and make "Sam" an Admin again
      Then the answer is the same seat invoice's payment page
      And no second invoice is created

    @unit
    Scenario: Another member's seat waits its turn behind the one already waiting
      Given "Sam" waits to become an Admin on an unpaid seat invoice
      When I add a seat and make "Kim" an Admin
      Then the change is refused with "seat_payment_waiting"
      And nothing is charged

    @unit
    Scenario: A paid seat invoice raises the seat line it was bought for
      Given the seat invoice was paid before the seat line rose
      When I come back to the member drawer
      Then the subscription bills 3 full seats, with no second charge
      And the change is paid

    @unit
    Scenario: A seat invoice left unpaid for a day is voided
      Given the seat invoice is still open 23 hours after it was issued
      When I come back to the member drawer
      Then the invoice is voided so it can no longer be paid
      And the change has failed

    @unit
    Scenario: A seat invoice with no payment page is voided and refused
      Given the seat invoice is left open but names no page to pay it on
      When I add a seat and make "Sam" an Admin
      Then the change is refused with "seat_payment_unavailable"
      And the invoice is voided so it can never be paid

    @unit
    Scenario: A seat change Stripe held before seat invoices settles once Stripe applies it
      Given Stripe holds a seat change for payment from before seat invoices
      When its invoice is paid but Stripe has not applied the change yet
      Then the change still waits
      And once the seat line rises the change is paid

  Rule: a paid seat stays paid even when the role change is then refused

    @unit
    Scenario: A paid seat whose role change is refused keeps the seat and says why
      Given the seat for "Sam" was paid
      And the change of "Sam" to Admin is then refused
      When the change applies
      Then the seat stays on the plan
      And the change says the seat was added but the role was not changed, with the reason

    @unit
    Scenario: A paid change asked by an admin who lost the right changes no role
      Given the seat for "Sam" was paid
      And the admin who asked can no longer change roles
      When the change applies
      Then the seat stays and the role is not changed, with the reason

    @unit
    Scenario: A newer role change replaces the one waiting on its payment
      Given "Sam" waits to become an Admin on a seat invoice
      And a seat frees up and an administrator makes "Sam" a Member
      When billing records that the seat invoice was paid
      Then "Sam" stays a Member and the waiting change ends as replaced

    @unit
    Scenario: A replaced change whose settling failed never applies its older role
      Given "Sam" waits to become an Admin on a seat invoice
      And a later role write for "Sam" commits, but ending the waiting change fails
      When billing records that the seat invoice was paid
      Then "Sam" keeps the later role and the waiting change ends as replaced
      And a paid change with no later role write still applies when delivered again

    @integration
    Scenario: Two role writes expecting one role version at once: exactly one writes
      Given "Sam"'s role version is read for two paid changes
      When both role writes run at once
      Then exactly one writes and the other is refused because the version moved

    @integration
    Scenario: Admitting a waiting member moves the role version
      Given "Kim" waits for a full seat
      When "Kim" is admitted, twice at once
      Then "Kim" is admitted once and the role version moves, so an older paid change is replaced

    @unit @integration
    Scenario: A paid change whose role write landed but whose settling failed ends as applied
      Given "Sam" waits to become an Admin on a seat invoice
      And billing records that the seat invoice was paid
      And "Sam" becomes an Admin, but marking the change applied fails
      When billing delivers the paid fact again
      Then the waiting change ends as applied, not replaced, and the role is written once

    @unit
    Scenario: A paid fact that cannot apply yet is delivered again
      Given "Sam" waits to become an Admin on a seat invoice
      And another applier holds the change
      When billing records that the seat invoice was paid
      Then the paid fact fails so eventing delivers it again

    @unit
    Scenario: Buying a seat with a role change needs both member and plan management
      When the door declares the seat role change procedures
      Then the purchase and its completion ask organization:manage and subscription:manage

  Rule: a seat checkout is proven paid by its own paid fact

    @unit
    Scenario: An adopted seat checkout waits for its own paid fact
      Given the seat checkout for "Sam" was adopted onto the operator-added plan
      When I come back to the member drawer before billing's paid fact
      Then the change is still waiting
      When billing records that this seat checkout was paid
      Then "Sam" is an Admin, exactly once

    @unit
    Scenario: An abandoned seat checkout fails its change
      Given "Sam" waits to become an Admin on a seat checkout
      When billing records that the seat checkout was abandoned
      Then the change has failed and "Sam" is still a Lite Member

    @unit
    Scenario: An expired seat checkout fails its change at once
      Given "Sam" waits to become an Admin on a seat checkout
      When Stripe expires that checkout session
      Then its pending plan row is cancelled and billing records the checkout as abandoned
      And the change has failed, nothing changed and "Sam" is still a Lite Member

    @unit
    Scenario: Seat billing off Cloud refuses the purchase by name
      Given LangWatch runs without seat billing
      When I add a seat and make "Sam" an Admin
      Then the change is refused with "seat_billing_unavailable"

  Rule: billing held on our side charges nothing and changes nothing

    @unit
    Scenario: A refused role change asked again while it waits is kept once
      Given my change of "Sam" to Admin was refused for two live subscriptions and is kept
      When the same change is refused again before billing is fixed
      Then it is still kept once
      And a refused change for another member is kept beside it

    @unit
    Scenario: Stuck billing refuses the seat by name
      Given "ACME" has two subscriptions live in Stripe
      When I add a seat and make "Sam" an Admin
      Then the change is refused with "subscription_ambiguous"
      And nothing is charged and "Sam" is still a Lite Member
      And ops were alerted

    @unit
    Scenario: Stuck billing still refuses by name when keeping the change fails
      Given "ACME" has two subscriptions live in Stripe
      And keeping the refused change for the admin fails
      When I add a seat and make "Sam" an Admin
      Then the change is refused with "subscription_ambiguous"
      And "Sam" is still a Lite Member

  # UI: the member drawer (organization) and billing's lent seat offer.

  Rule: the member drawer offers the seat in place and buys it in one click

    @integration
    Scenario: The offer appears under the role when no full seat is free
      Given I open the member drawer of "Sam"
      When I pick Admin as the organization role
      Then billing's seat offer shows under the role field
      And the footer keeps Cancel and drops Save

    @integration
    Scenario: The offer prices today and the recurring total on its one button
      Given one more seat costs $5.19 today and $102.00 a month from 14 Dec
      When the seat offer for making "Sam" an Admin shows
      Then it reads "No free full seat." and "Add 1 for $34.00/mo."
      And it shows "Today, prorated to 14 Dec" with $5.19
      And its one button reads "Add 1 seat and make Sam Admin · $5.19 today, then $102.00/mo"
      And it ends with "Then $102.00/mo for 3 seats from 14 Dec. Or move someone else to Lite instead."

    @integration
    Scenario: One click adds the seat and changes the role
      Given the seat offer shows under the role field
      When I press the offer's button
      Then the role changes with the seat bought at the quoted price
      And the drawer says "Sam is now an Admin"
      And a toast says "Sam is now an Admin" and "1 seat added, $5.19 paid."

    @integration
    Scenario: A seat bought for a refused role saves none of the staged access rows
      Given I staged the removal of one of Sam's access rows
      And the seat offer shows under the role field
      When I press the offer's button and the role is refused after the seat was bought
      Then the staged access rows are not saved and the seat counts are read again

    @integration
    Scenario: Access rows that do not save after the paid role change are named
      Given I staged a new access row for Sam
      And the seat offer shows under the role field
      When I press the offer's button and the role changes but the access rows are refused
      Then a toast says "Sam is now an Admin"
      And another toast says "The role changed, but the access rows did not save"

    @integration
    Scenario: The done state says what was paid
      Given I bought one seat for $5.19 to make "Sam" an Admin
      Then the seat offer says "Paid $5.19. ACME has 3 full seats, all in use. A receipt is on its way by email."
      And it names no card

    @integration
    Scenario: A payment the customer must finish waits, then applies
      Given the charge for the new seat needs the customer
      When I press the offer's button
      Then the drawer stays open and says it is waiting for the seat payment
      And a "Finish paying on Stripe" link opens the payment page in a new tab
      When the payment is paid
      Then the drawer says "Sam is now an Admin" in place, with the toast

    @integration
    Scenario: A reopened drawer resumes a change waiting on its payment
      Given "Sam" waits to become an Admin on an unpaid seat payment
      When I open the member drawer of "Sam"
      Then the drawer says it is waiting for the seat payment

    @integration
    Scenario: A failed payment changes nothing
      Given "Sam" waits to become an Admin on a seat payment
      When the payment fails
      Then the drawer says "The payment didn't go through, so nothing changed. Sam is still a Lite Member."
      And the seat offer shows again

    @integration
    Scenario: A bought seat refreshes the seat counts and says so once
      Given I bought one seat for $5.19 to make "Sam" an Admin, at once or after its payment waited
      When the change settles
      Then the members list, the seat usage and the plan's seat caps are read again
      And one toast says "Sam is now an Admin" and "1 seat added, $5.19 paid."
      And a failed re-read still shows the toast

    @integration
    Scenario: A paid seat whose role change was refused says so in the drawer
      Given the seat for "Sam" was paid and the change of "Sam" to Admin was then refused
      When the drawer learns the change settled
      Then it says "1 seat added and paid, but Sam's role could not be changed: <reason>."
      And it says "The seat is free for anyone."

    @integration
    Scenario: A seat change a later role change replaced says so in the drawer
      Given "Sam" waited to become an Admin on a seat payment
      And a later role change for "Sam" replaced it
      When the drawer learns the change settled
      Then it says "A later role change for Sam replaced this one, so it was not applied."
      And it says nothing about a paid seat

    @integration
    Scenario: Stuck billing shows the calm state with Contact support
      Given billing of "ACME" is held on our side
      When I press the offer's button
      Then the drawer says "We couldn't add the seat yet"
      And it says nothing was charged and "Sam is still a Lite Member."
      And a "Contact support" link shows below it
      And the role field shows Lite Member again

    @integration
    Scenario: A plan on custom terms points to support for the seat
      Given the plan of "ACME" has custom terms set up by our team
      When the seat offer for making "Sam" an Admin shows
      Then it says "Seats on ACME's plan are changed by our team"
      And it says "Your plan has custom terms, so we add seats for you. Nothing was charged and Sam is still a Lite Member."
      And a "Contact support" link is its action
      And no seat can be bought from the drawer

    @integration
    Scenario: A seat offer refused for two live subscriptions is kept for the admin
      Given "ACME" has two subscriptions live in Stripe
      When I pick Admin as the organization role of "Sam"
      Then the drawer shows the calm state with Contact support at once
      And the role field shows Lite Member again
      And the attempt is kept once for me, so I hear once billing is fixed
      And picking Admin again keeps nothing more and charges nothing

    @unit
    Scenario: Keeping a refused role change answers whether billing kept it
      Given a deployment where billing keeps no refused seat change
      When a role change refused for two live subscriptions is kept for me
      Then the answer says it was not recorded

    @integration
    Scenario: A plan without paid seats keeps Save
      Given "ACME" has no paid seat plan
      When I pick Admin as the organization role
      Then the footer keeps Save