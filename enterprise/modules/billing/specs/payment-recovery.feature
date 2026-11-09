Feature: A paid organization whose card fails is told, reminded, paused and restored

  When a renewal charge fails, Stripe retries it on its own schedule and nothing
  else changes for the customer. This flow tells the people who can pay, reminds
  them with the date access stops, warns them a week before, drops the
  organization to Free plan limits on day 21 without deleting anything, and
  restores the paid plan the moment the invoice is paid. Day 0 is the first
  failed charge of the oldest unpaid invoice. The people who can pay are the
  organization's admins and its Billing role holders.
  Design: enterprise/modules/billing/adrs/002-failed-payment-recovery.md

  # Day 0: the first failure

  @unit
  Scenario: The day a renewal payment fails, the organization keeps its paid plan
    Given an organization on an active paid subscription
    When Stripe reports an invoice payment failure
    Then the organization keeps its plan and the failure date is recorded

  @unit
  Scenario: The first failed charge opens a payment recovery case dated day 0
    Given an organization on an active paid subscription with no open recovery case
    When Stripe reports a failed charge on its renewal invoice
    Then a recovery case opens for that invoice, dated at the failed charge
    And access is due to stop 21 days after that date

  @unit
  Scenario: Stripe's later retries of the same invoice keep day 0 where it was
    Given an open recovery case for an invoice that failed 5 days ago
    When Stripe reports another failed charge on the same invoice
    Then the case keeps its original day 0 and its access stop date
    And no second day 0 email is sent

  @unit
  Scenario: A redelivered payment failure event changes nothing
    Given a payment failure event that has already been handled
    When Stripe delivers the identical event again
    Then the recovery case is unchanged and no email is sent twice

  @unit
  Scenario: A past due subscription update keeps the paid plan during recovery
    Given an organization on an active paid subscription
    When Stripe reports the subscription as past due
    Then the organization keeps its paid plan and its custom limits
    And the subscription is not recorded as cancelled

  @unit
  Scenario: Events arriving in any order open one case
    Given an organization on an active paid subscription
    When the past due update arrives before the invoice payment failure
    Then one recovery case is open, dated at the failed charge

  @unit @integration
  Scenario: The day 0 email belongs to the subscription that failed
    Given an organization with an older open recovery case on another subscription
    When Stripe reports a failed renewal charge on its current subscription
    Then the day 0 email is recorded on the current subscription's case
    And the older case keeps its own notice day

  @integration @unimplemented
  Scenario: Admins and billing members get the day 0 email
    Given an organization with two admins, one billing member and three plain members
    When its renewal payment fails
    Then the admins and the billing member each get one "Your LangWatch payment failed" email
    And the email names the amount, the card and an "Update card" button
    And the plain members get nothing

  @integration @unimplemented
  Scenario: A member who can pay sees the payment failed banner
    Given an organization with an open recovery case
    When an admin or a billing member opens any page
    Then a banner says the payment failed and names the date access stops
    And the banner's button opens the page to pay the open invoice

  @integration @unimplemented
  Scenario: A plain member sees no banner before access stops
    Given an organization with an open recovery case on day 4
    When a member without billing permission opens any page
    Then no payment banner is shown

  # Days 3 and 7: reminders, day 14: the final warning

  @unit
  Scenario Outline: A reminder goes out on day <day> with the access stop date
    Given an organization with an open recovery case that reached day <day>
    When the recovery sweep runs
    Then the people who can pay get the "payment is still due" reminder once
    And it names the date access stops and links the page to update the card

    Examples:
      | day |
      | 3   |
      | 7   |

  @unit
  Scenario: A final warning goes out on day 14 with the Free plan limits
    Given an organization with an open recovery case that reached day 14
    When the recovery sweep runs twice
    Then the people who can pay get one "Your LangWatch plan pauses on" email
    And it lists the Free plan limits and links the page to pay the invoice

  @unit
  Scenario: A sweep that missed a day sends only the latest reminder due
    Given an open recovery case on day 8 whose day 3 reminder was sent
    And no sweep ran on day 7
    When the recovery sweep runs
    Then only the day 7 reminder is sent

  @unit
  Scenario: Two sweeps on the same day send a reminder once
    Given an open recovery case whose day 7 reminder was sent this morning
    When the recovery sweep runs again
    Then no reminder is sent

  @unit
  Scenario: A reminder that fails to send for one person still reaches the others
    Given an open recovery case due its day 3 reminder for three people
    And the mail provider refuses one of the addresses
    When the recovery sweep runs
    Then the other two get the reminder and the reminder counts as sent
    And the refused address is logged by id, not by email

  @unit
  Scenario: A reminder whose recipients cannot be read goes out on the next sweep
    Given an open recovery case due its day 3 reminder
    And the people who can pay cannot be read on the first sweep
    When the recovery sweep runs twice
    Then the first sweep leaves the reminder unsent
    And the second sweep sends it once

  @unit
  Scenario: A reminder with nobody to send to is recorded, not retried forever
    Given an open recovery case whose organization has no admin with a deliverable address
    When the recovery sweep runs
    Then the reminder is recorded as having no recipients and the sweep goes on

  # Day 21: paused to Free limits

  @unit
  Scenario: On day 21 unpaid, the organization runs on Free plan limits
    Given an organization with an open recovery case that reached day 21
    When its plan is resolved
    Then it answers the Free plan limits
    And its projects, traces, members and settings are all kept

  @unit
  Scenario: The pause takes effect at day 21 even when the sweep is late
    Given an open recovery case at day 21 and one hour, before any sweep ran
    When the organization's plan is resolved
    Then it answers the Free plan limits

  @unit
  Scenario: The paused email goes out once on day 21
    Given an organization with an open recovery case that reached day 21
    When the recovery sweep runs twice
    Then the people who can pay get one "Your plan is paused" email with a "Pay now" button

  @unit @unimplemented
  Scenario: The pause is recorded once for peers
    Given an organization with an open recovery case that reached day 21
    When the recovery sweep runs twice
    Then one access paused fact is recorded for peers

  @integration @unimplemented
  Scenario: An admin of a paused organization sees the paused notice with a pay button
    Given an organization paused for an unpaid invoice
    When an admin or a billing member opens any page
    Then a notice says the organization is on Free limits until the invoice is paid
    And its button opens the page to pay the open invoice

  @integration @unimplemented
  Scenario: A plain member of a paused organization is told to ask an admin
    Given an organization paused for an unpaid invoice
    When a member without billing permission opens any page
    Then a notice says the organization is on Free limits and an admin can restore it
    And it shows no pay button

  @unit @unimplemented
  Scenario: A paused organization over the Free limits keeps what it has
    Given a paused organization with more members and projects than Free allows
    When an admin tries to add a member or a project
    Then the addition is refused with the Free plan limit error
    And no existing member or project is removed

  # Recovery at every stage

  @unit
  Scenario Outline: Paying the invoice on <stage> restores the paid plan at once
    Given an organization with an open recovery case at <stage>
    When Stripe reports the invoice as paid
    Then the recovery case closes and the organization is on its paid plan with its limits
    And no further reminder is sent

    Examples:
      | stage                       |
      | day 0                       |
      | day 5, after one reminder   |
      | day 21, while paused        |
      | day 40, while paused        |

  @unit
  Scenario: Every recovery sends one restored email
    Given an organization with an open recovery case at any stage
    When the invoice is paid
    Then the case closes
    And the people who can pay get one "Thanks, you're back" email

  @integration @unimplemented
  Scenario: Recovery clears the banner
    Given a paused organization
    When its open invoice is paid
    Then the next page load shows no payment banner or paused notice

  @unit
  Scenario: Both paid events of one invoice close the case once
    Given a recovery case closed by an invoice paid event
    When Stripe also delivers payment succeeded for the same invoice
    Then nothing changes and no second email is sent

  @unit
  Scenario: A paid invoice for a different invoice leaves the case open
    Given a recovery case for the renewal invoice
    When Stripe reports a separate seat change invoice as paid
    Then the case stays open with its original access stop date

  @unit
  Scenario: A new card alone does not close the case
    Given an organization with an open recovery case
    When the customer updates the card in the billing portal and no charge has succeeded yet
    Then the case stays open until Stripe reports the invoice paid

  @unit @integration
  Scenario: A paused case whose paid event never arrived closes on the next sweep
    Given an organization paused on day 21 for an unpaid invoice
    And the invoice was paid but Stripe's paid event never arrived
    When the recovery sweep runs
    Then the case closes and the organization is on its paid plan with its limits
    And the people who can pay get one "Thanks, you're back" email

  @unit
  Scenario: A paid event whose recipients cannot be read makes Stripe retry
    Given an organization with an open recovery case
    And the people who can pay cannot be read
    When Stripe reports the invoice as paid
    Then the delivery fails and the case stays open
    And the redelivery closes the case and sends the restored email

  # Cancellation and ending

  @unit
  Scenario: A subscription cancelled during recovery closes the case and lands on Free
    Given an organization with an open recovery case
    When Stripe reports the subscription as deleted
    Then the case closes without a restored email
    And the organization is on the Free plan like any cancelled subscription

  @unit
  Scenario: An invoice voided or marked uncollectible by staff closes the case
    Given an organization with an open recovery case
    When the invoice is voided or marked uncollectible in Stripe
    Then the case closes and the organization keeps its paid plan
    And no further reminder is sent

  @unit
  Scenario: A subscription Stripe marks unpaid stays paused, not cancelled
    Given a paused organization
    When Stripe reports the subscription status as unpaid
    Then the organization stays paused and can still pay to restore it

  # Organizations that are never paused

  @unit
  Scenario: An enterprise organization's failed payment never pauses it
    Given an organization on the Enterprise plan
    When a charge on one of its invoices fails
    Then no recovery case opens, no email is sent and its plan is unchanged
    And the account team is alerted in Slack

  @unit
  Scenario: An organization billed by invoice is never paused
    Given an organization whose subscription collects by sent invoice, not by card
    When its invoice passes its due date unpaid
    Then no recovery case opens and its plan is unchanged

  @unit
  Scenario: A connected self-hosted customer's failed payment is not cloud recovery
    Given a connected self-hosted customer with a Stripe account
    When a payment on its invoice fails
    Then cloud payment recovery ignores it

  @unit
  Scenario: A first checkout that fails is not a recovery case
    Given an organization whose first checkout payment failed
    When Stripe reports the payment failure
    Then the subscription is recorded as failed and no recovery case opens

  # Errors

  @unit
  Scenario: A payment failure for an unknown subscription is acknowledged
    Given a payment failure event naming a subscription this installation has no record of
    When the webhook handles it
    Then no case opens and the event is acknowledged rather than retried forever

  @unit
  Scenario: A database failure while opening a case makes Stripe retry
    Given a database that cannot be reached
    When Stripe reports a payment failure
    Then the delivery fails so Stripe redelivers it, and the redelivery opens the case

  @unit
  Scenario: A pay link that cannot be created falls back to the billing page
    Given an open recovery case whose Stripe invoice page cannot be read
    When an admin presses the pay button
    Then they land on the organization's billing page with a retry
    And the error is reported with a trace id, not shown as an unknown error

  @unit
  Scenario: Only people who can manage the subscription read the recovery case
    Given an organization with an open recovery case
    When a member without subscription management permission asks for the case details
    Then the request is refused for that permission
    And the member can still read whether the organization is paused
