Feature: Buying seats
  An administrator buys full seats where they plan them. Upgrading from Free asks for one number,
  the full seats, before Stripe Checkout. On Free, the Manage seats confirm is the upgrade once the
  people planned are more than Free covers. On Growth, the same drawer adds or lowers seats in
  place after a confirm that names the charge. Lite and Developer seats fold under "Other seat
  types". Planning never marks the plan red: only people already over the plan do.

  Background:
    Given an organization "ACME" on LangWatch Cloud, billed in euros at €29 a full seat a month
    And I am an administrator of "ACME"

  Rule: upgrading to Growth picks the full seats in a short dialog first

    @integration
    Scenario: Upgrade to Growth on the plan card opens the seat dialog
      Given "ACME" is on the Free plan with 1 member
      When I choose "Upgrade to Growth" on the plan card
      Then a dialog "Upgrade to Growth" asks for the full seats, starting at 1
      And it reads "200,000 events a month included. Lite members free."
      And it reads "Invite people after checkout."
      And no checkout has started

    @integration
    Scenario: The seat dialog totals the price as the seats change
      Given "ACME" is on the Free plan with 1 member
      And the seat dialog is open
      When I raise the full seats to 3
      Then the dialog reads "€87/mo" and "3 seats × €29"

    @integration
    Scenario: The seat dialog never goes below the people already in the organization
      Given "ACME" is on the Free plan with 3 members
      When I open the seat dialog
      Then the full seats start at 3 and cannot be lowered
      And it reads "3 people are already in your organization, so you need at least 3 full seats."

    @integration
    Scenario: Continue to checkout starts the Growth checkout for the chosen seats
      Given "ACME" is on the Free plan with 1 member
      And the seat dialog is open with 3 full seats
      When I choose "Continue to checkout"
      Then a monthly Growth checkout in euros for 3 seats is created
      And I am sent to the Stripe Checkout page it answers

    @integration
    Scenario: Cancel closes the seat dialog without a checkout
      Given the seat dialog is open
      When I choose "Cancel"
      Then the dialog closes
      And no checkout has started

    @integration
    Scenario: A checkout that fails to start says why and keeps the dialog open
      Given the seat dialog is open with 3 full seats
      And the payment provider refuses to open a checkout
      When I choose "Continue to checkout"
      Then I am told the upgrade could not start
      And the seat dialog is still open with 3 full seats

    @integration
    Scenario: The Growth offer opens the seat dialog
      Given "ACME" is on the Free plan with 1 member
      When I choose "Upgrade now" in the Growth offer
      Then the seat dialog opens
      And no checkout has started

    @integration
    Scenario: Arriving from All plans opens the seat dialog in the chosen interval and currency
      Given "ACME" is on the Free plan with 2 members
      When I arrive on the subscription page from All plans asking for the annual Growth plan in USD
      Then the seat dialog opens with 2 full seats
      And the page is set to annual billing in USD
      And no checkout has started until I choose "Continue to checkout"

    @unit
    Scenario: The usage page upgrade leads to the seat dialog
      Given "ACME" is on the Free plan
      When I read where the usage page's "Upgrade plan" goes
      Then it goes to the subscription page asking for the Growth seat dialog

  Rule: on Free, Manage seats invites into Free and becomes the upgrade past it

    @integration
    Scenario: Manage seats on Free says what Free includes
      Given "ACME" is on the Free plan with 1 member
      When I open Manage seats
      Then it reads "Free includes 2 seats. 1 in use."
      And the summary reads "Plan Free", "Seats 1 of 2 included" and "Monthly price €0"
      And the confirm reads "No changes" and cannot be chosen
      And there is no "Done" button and no "Other seat types"

    @integration
    Scenario: Manage seats on Free names a held seat and the day it frees
      Given "ACME" is on the Free plan with 1 member and 2 full seats in use
      And the organization's held seats list one seat that frees on 7 Dec
      When I open Manage seats
      Then it reads "Free includes 2 seats. 2 in use, 1 of them held until 7 Dec."
      But when the held seats list none, it reads "Free includes 2 seats. 2 in use."

    @integration
    Scenario: A reader who may not manage the organization sees no held seats
      Given "ACME" is on the Free plan with 1 member and 2 full seats in use
      And one of those seats is held until 7 Dec
      And I do not hold organization:manage
      When I open Manage seats
      Then the held seats are not asked for
      And it reads "Free includes 2 seats. 2 in use."

    @integration
    Scenario: An invite that fits Free is sent at once
      Given "ACME" is on the Free plan with 1 member
      And Manage seats is open
      When I add "maria@acme.example"
      Then the row reads "Invited now"
      And the confirm reads "Invite 1 person"
      When I choose "Invite 1 person"
      Then "maria@acme.example" is invited
      And no checkout has started

    @integration
    Scenario: Planning more people than Free covers turns the confirm into the upgrade
      Given "ACME" is on the Free plan with 1 member
      And Manage seats is open
      When I add "maria@acme.example" and "joao@acme.example"
      Then the confirm reads "Upgrade and invite 2 people · €87/mo"
      And both rows read "Invited after payment"
      And it reads "3 people is more than Free covers. Growth bills every full seat, 3 × €29."
      And the summary reads "Plan Free → Growth", "Full seats 3 × €29" and "Monthly price €87/mo"

    @integration
    Scenario: The upgrade from Manage seats checks out with the invites held until payment
      Given Manage seats on Free plans "maria@acme.example" and "joao@acme.example"
      When I choose "Upgrade and invite 2 people · €87/mo"
      Then a Growth checkout for 3 seats carrying both invites is created
      And nobody is invited before the payment

    @integration
    Scenario: An address that is not an email blocks the confirm
      Given Manage seats on Free is open
      When I add "not-an-email" and choose the confirm
      Then the row says "Please enter a valid email address"
      And nobody is invited and no checkout has started

  Rule: on Growth, Manage seats adds or lowers seats in place after a confirm

    @integration
    Scenario: Manage seats on Growth shows the seats paid for
      Given "ACME" has a Growth subscription for 3 seats with 3 in use
      When I open Manage seats
      Then it reads "You pay for 3. 3 in use."
      And the full seats read 3
      And the confirm reads "No changes" and cannot be chosen

    @integration
    Scenario: Inviting past the seats paid for raises the count
      Given "ACME" has a Growth subscription for 3 seats with 3 in use
      And Manage seats is open
      When I add "qux@acme.example"
      Then the full seats read 4
      And the row reads "Invited when you confirm"
      And the confirm reads "Add 1 seat · €29/mo"
      And the summary reads "Full seats 3 → 4", the prorated amount due today and the price from the next period
      And it reads "Added to your subscription now, prorated to 1 Dec. No new checkout."

    @integration
    Scenario: Adding seats asks to confirm the charge
      Given Manage seats on Growth raises the seats from 3 to 4 for "qux@acme.example"
      When I choose "Add 1 seat · €29/mo"
      Then a dialog "Add 1 seat to your organization?" names the amount charged today and the period it covers
      And it reads the price from 1 Dec, "4 seats × €29"
      And it reads "qux@acme.example gets the invite as soon as the seat is added."
      And its button reads "Pay €24.17 and add"

    @integration
    Scenario: Confirming the added seat changes the subscription and sends the invite
      Given the confirm to add 1 seat for "qux@acme.example" is open
      When I choose "Pay €24.17 and add"
      Then the subscription is changed to 4 seats at the price I was quoted
      And "qux@acme.example" is invited
      And I am told "Seat added. You now pay for 4 seats. Invite sent to qux@acme.example."
      And Manage seats closes with no pending seat change left on the page

    @integration
    Scenario: Back from the confirm returns to the drawer unchanged
      Given the confirm to add 1 seat for "qux@acme.example" is open
      When I choose "Back"
      Then Manage seats still shows 4 full seats and "qux@acme.example"
      And the subscription is not changed

    @integration
    Scenario: Inviting into a seat already paid for sends the invite at once
      Given "ACME" has a Growth subscription for 5 seats with 3 in use
      And Manage seats is open
      When I add "qux@acme.example"
      Then the full seats still read 5
      And the confirm reads "Invite 1 person"
      When I choose "Invite 1 person"
      Then "qux@acme.example" is invited and the subscription is not changed

    @integration
    Scenario: Lowering seats stops at the people who use them
      Given "ACME" has a Growth subscription for 5 seats with 3 in use
      And Manage seats is open
      When I lower the full seats to 3
      Then they cannot be lowered further
      And it reads "3 people use full seats. Remove someone in Users to go lower."

    @integration
    Scenario: Lowering seats names the seats held for people who left them
      Given "ACME" has a Growth subscription for 5 seats with 2 members and 3 full seats in use
      And the organization's held seats list one seat that frees on 7 Dec
      And Manage seats is open
      When I lower the full seats to 3
      Then it reads "You pay for 5. 3 in use, 1 of them held until 7 Dec."
      And it reads "2 people use full seats and 1 more is held until 7 Dec. Remove someone in Users to go lower."

    @integration
    Scenario: Lowering seats asks to confirm from the next period
      Given Manage seats on Growth lowers the seats from 5 to 3
      When I choose "Lower to 3 seats"
      Then a dialog "Lower to 3 seats from 1 Dec?" reads "You keep 5 seats until 1 Dec. From then you pay €87/mo for 3. No refund for the rest of this month."
      When I choose "Lower to 3 seats" in the dialog
      Then the subscription is changed to 3 seats
      And I am told "From 1 Dec you pay for 3 seats."

    @integration
    Scenario: A price that did not load keeps the confirm from being chosen
      Given Manage seats on Growth raises the seats from 3 to 4
      And the price for that change did not load
      Then the confirm cannot be chosen and says the price did not load

    @integration
    Scenario: A charge the payment provider refuses keeps the confirm open and invites nobody
      Given the confirm to add 1 seat for "qux@acme.example" is open
      And the payment provider refuses the change
      When I choose "Pay €24.17 and add"
      Then I am told the seats could not be updated
      And "qux@acme.example" is not invited
      And the confirm is still open

    @integration
    Scenario: An invite refused after the seats changed keeps Manage seats open
      Given the confirm to add 1 seat for "qux@acme.example" is open
      And the invitation for "qux@acme.example" is refused
      When I choose "Pay €24.17 and add"
      Then the subscription is changed to 4 seats
      And I am told the invites could not be sent
      And I am not told the seat was added with an invite sent
      And the confirm closes and Manage seats stays open

    @unit
    Scenario: Lowering full seats while adding Developer seats names what is due today
      Given a Developer seat price of €5 a month is configured
      And Manage seats on Growth lowers the full seats from 5 to 3 and raises the Developer seats from 0 to 2
      When the confirm is shown
      Then its first line reads "Today" with the prorated Developer seat amount charged today
      And it still reads the seats kept until 1 Dec and the price from 1 Dec

  Rule: Lite and Developer seats fold under Other seat types in Manage seats

    @integration
    Scenario: Other seat types are folded at the bottom of Manage seats on Growth
      Given "ACME" has a Growth subscription for 3 seats
      When I open Manage seats
      Then "Other seat types" is folded
      When I unfold it
      Then it reads "Lite members" with "Read only. Free and unlimited on Growth." and "Free"

    @integration
    Scenario: Developer seats are not offered while no Developer price is configured
      Given no Developer seat price is configured
      When I unfold "Other seat types" in Manage seats on Growth
      Then there is no Developer row

    @integration
    Scenario: Adding Developer seats prices them
      Given a Developer seat price of €5 a month is configured
      And Manage seats on Growth is open with "Other seat types" unfolded
      When I raise the Developer seats from 0 to 2
      Then the confirm reads "Add 2 developer seats · €10/mo"
      And the summary reads "Developer seats 2 × €5"

    @integration
    Scenario: Confirming Developer seats changes the subscription
      Given Manage seats on Growth adds 2 Developer seats at €5 a month
      When I confirm the change
      Then the subscription carries 2 Developer seats at the price I was quoted
      And I am told "You now pay for 2 developer seats."
      And Manage seats opened again reads 2 Developer seats

    @unit
    Scenario: The message after a seat change names the Developer seats that changed
      Given a Growth subscription for 4 full seats and 2 Developer seats
      When the full seats stay at 4 and the Developer seats go to 3
      Then I am told "You now pay for 3 developer seats."
      When the full seats stay at 4 and the Developer seats go down to 1
      Then I am told "From 1 Dec you pay for 1 developer seat."
      When the full seats go to 5 and the Developer seats go to 3
      Then I am told "Seat added. You now pay for 5 seats and 3 developer seats."

    @integration
    Scenario: The plan card and the seat dialog never show Developer seats
      Given a Developer seat price is configured
      When I view the subscription page and open the seat dialog
      Then neither mentions Developer seats

    @unit
    Scenario: Developer seats read as unavailable while no price is configured
      Given no Developer seat price is configured for the subscription's currency and interval
      When the Developer seats of "ACME" are read
      Then they read as unavailable with no price

    @unit
    Scenario: Developer seats read the configured price and the quantity billed
      Given a Developer seat price of €5 a month is configured
      And the subscription bills 2 Developer seats
      When the Developer seats of "ACME" are read
      Then they read as available, 2 billed at €5 a month

    @unit
    Scenario: Adding Developer seats adds a line at the configured price, charged now
      Given a Developer seat price of €5 a month is configured
      And the subscription bills no Developer seats
      When an administrator sets 2 Developer seats
      Then the subscription gets a Developer seat line of 2, invoiced now at the quoted instant

    @unit
    Scenario: Lowering Developer seats changes the line from the next period with no credit
      Given the subscription bills 3 Developer seats
      And 1 Developer is in use
      When an administrator sets 1 Developer seat
      Then the Developer seat line moves to 1 with no proration

    @unit
    Scenario: Removing every Developer seat removes the line
      Given the subscription bills 2 Developer seats
      When an administrator sets 0 Developer seats
      Then the Developer seat line is removed

    @unit
    Scenario: Setting Developer seats without a configured price is refused
      Given no Developer seat price is configured
      When an administrator sets 2 Developer seats
      Then the change is refused as Developer seats being unavailable
      And the subscription is not changed

    @unit
    Scenario: The Developer seat quote prices the change before it is confirmed
      Given a Developer seat price of €5 a month is configured
      When an administrator asks what 2 Developer seats cost
      Then the quote names the amount due today, €10 a month from the next period, and the instant it priced

  Rule: the plan turns red only for real over-use, never for a plan in progress

    @integration
    Scenario: Planning people in Manage seats never marks an upgrade as required
      Given "ACME" is on the Free plan with 1 member
      When I add two people in Manage seats and choose "Cancel"
      Then the plan card reads "1 / 2" in the normal colour
      And I am not told an upgrade is required
      And nobody is invited

    @integration
    Scenario: The quote tells the drawer when the next period starts
      Given "ACME" has a Growth subscription whose period ends on 1 Dec
      When Manage seats raises the seats from 3 to 4
      Then the drawer reads "Then from 1 Dec"

  Rule: prices read before paying say they exclude VAT, and a charge today names its VAT

    # Cloud prices exclude VAT. A buyer who owes it (in the Netherlands, or in the EU without a
    # VAT ID) pays it on top at checkout, so every price shown before paying says so.
    @integration
    Scenario: The seat dialog says its total excludes VAT
      Given "ACME" is on the Free plan with 1 member
      When I open the seat dialog
      Then the total reads "€29/mo" and "excl. VAT"

    @integration
    Scenario: The Growth offer says its price excludes VAT
      Given "ACME" is on the Free plan with 2 members
      When I view the subscription page
      Then the Growth offer reads "€58/mo for 2 seats" and "excl. VAT"

    @integration
    Scenario: The plan card price says it excludes VAT
      Given "ACME" has a Growth subscription for 2 seats
      When I view the subscription page
      Then the price row reads "€58/mo" and "excl. VAT"

    @integration
    Scenario: The seat change confirm splits VAT out of the charge today
      Given Manage seats on Growth raises the seats from 3 to 4 for "qux@acme.example"
      And the change charges €29.24 today, €5.07 of it VAT
      When I choose "Add 1 seat · €29/mo"
      Then the confirm reads "€29.24" today with "€24.17 + €5.07 VAT"
      And it reads the price from 1 Dec as "€116/mo" and "excl. VAT"
      And its button reads "Pay €29.24 and add"

    @unit
    Scenario: A charge today with no VAT names no split
      Given Manage seats on Growth raises the seats from 3 to 4
      And the change charges €24.17 today with no VAT
      When the confirm is shown
      Then today reads "€24.17" with no VAT split
      And the price from 1 Dec still says it excludes VAT

    @unit
    Scenario: The drawer summary splits VAT out of the amount due today
      Given Manage seats on Growth raises the seats from 3 to 4
      And the change charges €29.24 today, €5.07 of it VAT
      Then the summary reads "Due today, prorated" "€29.24" with "€24.17 + €5.07 VAT"
      And "Then from 1 Dec" "€116/mo" with "excl. VAT"

    @unit
    Scenario: Lowering seats says each recurring price excludes VAT
      Given Manage seats on Growth lowers the seats from 4 to 3
      Then the summary and the confirm read "Until 1 Dec" "€116/mo" with "excl. VAT"
      And "From 1 Dec" "€87/mo" with "excl. VAT"

    @unit
    Scenario: The monthly price with no seat change, and Free past its seats, exclude VAT
      Given Manage seats on Growth keeps 3 seats
      Then the summary reads "Monthly price" "€87/mo" with "excl. VAT"
      And on Free, inviting past the included seats reads "Monthly price" "€87/mo" with "excl. VAT"
      And on Free within the included seats the €0 price carries no note
