Feature: Proration Preview Before Seat Update

  # All scenarios in this file describe the Seat-update proration-preview
  # modal on the Subscription page (loading state, error state, calculation
  # base, cancel behavior). The previewProration backend method is unit tested
  # in enterprise/modules/billing/process/src/__tests__/seatEventSubscription.unit.test.ts;
  # the modal itself is covered by
  # [gone] src/components/__tests__/UpgradeModal.integration.test.tsx.

  As a Growth plan (SEAT_EVENT) administrator
  I want to see the prorated charges before confirming a seat update
  So that I understand exactly what I'll be charged immediately before committing

  Seat upgrades are charged immediately (not deferred to the next invoice).
  The proration preview shows the exact amount that will be invoiced at the
  moment the update is confirmed. Seat reductions apply from the next billing
  cycle with no credit, so their preview charges nothing today
  (specs/licensing/seat-rotation.feature).

  Background:
    Given I am logged in as an organization administrator on LangWatch Cloud
    And the organization uses the SEAT_EVENT pricing model
    And the organization has an active Growth subscription

  # ============================================================================
  # Backend: Proration Preview Query
  # ============================================================================

  # The preview and the confirmed update must describe the same operation. They
  # did not: the update reverses a scheduled cancellation before applying the
  # new quantity, while the preview modelled the subscription as still
  # cancelling. On an annual plan billed alongside a monthly meter, cancellation
  # truncates the seat line to the monthly boundary, so one seat change was
  # quoted 54.25 and charged 639.91.
  @unit
  Scenario: Preview quotes the same change the confirmation applies
    Given the subscription is scheduled for cancellation
    When I preview a seat increase
    Then the preview models the subscription as no longer cancelling
    And the previewed change matches the change the confirmation applies

  # Confirming invoices immediately, which bills every proration the
  # subscription is already carrying — not just the incremental seat cost.
  @unit
  Scenario: Amount due counts prorations the subscription already carried
    Given the subscription carries a pending proration from a mid-cycle billing anchor
    When I preview a seat increase
    Then the amount due includes that pending proration

  @unit
  Scenario: Reducing seats previews nothing due today and when the lower count applies
    When I preview a seat decrease
    Then the amount due today is zero
    And the preview names the date the lower count starts billing
    And the seats kept until then with their price

  # An account can be holding credit from an earlier change. The invoice total
  # and the amount the card is charged then differ by that credit, and only one
  # of them is what "Due today" means.
  @unit
  Scenario: Due today is the amount the card is charged, not the invoice total
    Given the organization is holding account credit
    When I preview a seat increase
    Then the amount due is the invoice total less the credit spent on it
    And the preview reports how much credit was applied

  # Where tax is added on top of the price rather than included in it, the
  # amounts on the invoice's own lines are pre-tax.
  @unit
  Scenario: Amount due includes tax where the currency is taxed on top
    Given the organization is billed in a currency where tax is added on top
    When I preview a seat increase
    Then the amount due is the taxed total the customer will be charged

  # Cloud prices exclude VAT, so a buyer owing VAT pays more today than the
  # price beside it. The quote names that VAT so the dialog can show the split.
  @unit
  Scenario: The quote names the tax inside the amount due
    Given the organization owes VAT on top of the price
    When I preview a seat increase
    Then the quote reports the VAT inside the amount due
    And the amount due before VAT

  @unit
  Scenario: Account credit carries its share of the tax
    Given the organization owes VAT on top of the price
    And account credit pays part of the change
    When I preview a seat increase
    Then the VAT reported is the share inside the amount left to pay
    And the amount before VAT plus that VAT equals the amount due

  @unit
  Scenario: A quote with no tax names none
    Given the organization owes no VAT on the change
    When I preview a seat increase
    Then the quote reports no VAT

  @unit
  Scenario: Amount due survives an invoice whose lines span more than one page
    Given the previewed invoice has more lines than fit on one page
    When I preview a seat increase
    Then the amount due covers the whole invoice

  # Subscriptions migrated to flexible billing are rejected outright by the
  # Upcoming Invoice API on every API version.
  @unit
  Scenario: Preview works for subscriptions on flexible billing
    Given the organization's subscription uses flexible billing
    When I preview a seat change
    Then I receive a quote rather than an error

  # ============================================================================
  # Backend: Seat Update Failures
  # ============================================================================

  # Only the checkout webhook writes the link between our subscription record
  # and the provider's, so a subscription an operator added by hand has none and
  # no amount of waiting produces it: its seats are bought through checkout,
  # whose completion links that row.
  @unit
  Scenario: A seat change on a plan that never reached Stripe goes to checkout
    Given the organization's only active subscription has no billing-provider link
    When I preview a seat change
    Then the seat change is refused as one that needs checkout
    And the failure is not reported as details that will catch up on their own

  @unit
  Scenario: An unlinked subscription blocks the seat update itself
    Given the organization's active subscription has no billing-provider link
    When I confirm a seat update
    Then the update is refused as one that needs checkout rather than reporting success
    And no seat change is sent to the billing provider

  # A cancelled subscription keeps its provider link on purpose, so a churned
  # subscription is a permanent record. Ranking candidates by recency alone let
  # that record answer for an organization whose live plan was never linked.
  @unit
  Scenario: A cancelled subscription does not mask an unlinked active one
    Given the organization has a cancelled subscription that kept its link
    And the organization's active subscription has no billing-provider link
    When I preview a seat change
    Then the seat change is refused as one that needs checkout

  # Two active rows on one account come from an Ops edit beside a Stripe checkout.
  # A row nothing bills in Stripe is a stray: closing it loses nobody money.
  # Two rows Stripe bills are a coin flip against a card, which only ops can settle.
  @unit
  Scenario: A stray local subscription beside the one live in Stripe is closed and the change goes on
    Given the organization has two active subscriptions
    And only one of them is live in Stripe
    When I confirm a seat change
    Then the other subscription is cancelled, recorded on the audit log first
    And the change is applied on the one live in Stripe

  @unit
  Scenario: A seat preview beside a stray local subscription changes nothing
    Given the organization has two active subscriptions, one linked to Stripe and one local
    When I preview a seat change or open the seat offer
    Then the change is priced on the linked one
    And no subscription is cancelled, nothing is audited and Stripe is asked about the linked one only

  @unit
  Scenario: A custom plan beside the live one is never closed on its own
    Given the organization has two active subscriptions, one linked to Stripe
    And the other is ENTERPRISE or carries limits an operator set
    When I preview or confirm a seat change
    Then the change is refused as an account we cannot tell apart, and ops are alerted
    And no subscription is cancelled

  @unit
  Scenario: A seat change on a custom plan goes to support, not checkout
    Given the organization's only active subscription is ENTERPRISE or carries limits an operator set, with no billing-provider link
    When I preview a seat change or ask for a seat checkout
    Then the change is refused with seat_change_needs_support, whose copy points to Contact support
    And no checkout is opened

  @unit
  Scenario: Two active subscriptions refuse a seat change rather than picking one
    Given the organization has two active subscriptions, both live in Stripe
    When I preview or confirm a seat change
    Then the change is refused as an account we cannot tell apart
    And nothing is sent to the billing provider
    And ops are alerted in the plan-limit channel with the organization, its admin, its plan and both subscription ids
    And the customer is told nothing was charged and that we were alerted

  @unit
  Scenario: A closing that cannot be audited is refused rather than applied
    Given the organization has two active subscriptions and only one is live in Stripe
    And the audit entry cannot be recorded
    When I confirm a seat change
    Then the change is refused as an account we cannot tell apart
    And no subscription is cancelled

  @unit
  Scenario: Ops hear about the same organization's duplicate plans once a day
    Given a seat change for an organization was refused for two live subscriptions
    When the customer retries again and again that day
    Then ops are alerted once
    And an alert that cannot be sent never changes the refusal the customer sees

  # Mid-term changes are priced by the moment they are applied, so a quote and
  # a confirmation made at different instants are different amounts.
  @unit
  Scenario: The charge prices the same instant the quote did
    Given I confirm a seat change against a quote issued a moment ago
    When the change is sent to the billing provider
    Then it is priced at the instant the quote was issued

  @unit
  Scenario: A quote too old to honour is refused rather than repriced
    Given the confirmation dialog has been open past the quote's validity
    When I confirm the seat change
    Then the change is refused as an out-of-date quote
    And nothing is sent to the billing provider

  @unit
  Scenario: A live subscription outranks a more recent cancelled one
    Given the organization has a cancelled subscription created after its active one
    When I preview a seat change
    Then the preview acts on the active subscription

  @unit
  Scenario: Seat updates can reverse a scheduled cancellation
    Given the organization's only subscription is cancelled but still live at the provider
    When I confirm a seat update
    Then the subscription is reactivated along with the new seat count

  # A failure that resolves as `{ success: false }` was reported to the customer
  # as "Seats updated successfully" over a seat count that never moved.
  @unit
  Scenario: A seat update that cannot proceed fails instead of resolving quietly
    Given the organization has no subscription to change
    When I confirm a seat update
    Then the update fails rather than reporting success

  # A seat change refused for two live subscriptions is kept for the admin who
  # tried, so the admin hears once that billing works again, with what finishing
  # the change costs now. One email per admin, however many tries they made.
  @unit
  Scenario: A seat change refused for two live subscriptions is remembered for the admin who tried
    Given the organization has two active subscriptions live in Stripe
    When an admin tries to make a member an Admin, which needs one more seat
    Then the seat change is refused as subscription_ambiguous
    And billing records the admin and the role change they tried
    And the seats it needed count from the plan billed in Stripe, not a local row

  @unit
  Scenario: The admin hears once that billing is fixed
    Given a seat change an admin tried was refused for two live subscriptions
    When the organization is back on one subscription
    Then that admin gets one "billing is fixed" email with what finishing the change costs now
    And a later pass sends nothing more

  @unit
  Scenario: No billing-fixed email while the subscriptions are still ambiguous
    Given a seat change an admin tried was refused for two live subscriptions
    When the organization still holds two live subscriptions
    Then no email is sent and the attempt stays recorded

  @unit
  Scenario: The billing-fixed notice runs every 15 minutes
    Given billing is installed
    When the billing-fixed notice is scheduled
    Then it wakes every 15 minutes and asks for one notice pass per wake
    And each pass prunes its own outbox rows older than a week

  @unit
  Scenario: The billing-fixed email says what was tried, what finishing costs and that nothing was charged
    Given an admin tried to make a member an Admin while billing was blocked
    When the billing-fixed email is rendered
    Then it names the member and the role, the amount due today and the recurring total from the renewal date
    And it links to the members page and says nothing was charged while it was blocked

  @integration
  Scenario: Refused seat changes are kept on Postgres until the admin is told
    Given a seat change an admin tried was refused for two live subscriptions
    When billing records it and later marks it told
    Then it is listed as waiting until then and never after

  # ============================================================================
  # Client: Retrying A Failed Preview
  # ============================================================================

  # Both failures answer 409 from the same procedure and want opposite
  # treatment, so the rule reads the failure's code, not its status.
  @unit
  Scenario: A preview failure only an operator can fix is not retried
    Given the preview fails because the subscription is not linked
    When the client decides whether to try again
    Then it does not retry
    And a preview that needs checkout is not retried either

  @unit
  Scenario: A preview failure that resolves itself is retried
    Given the preview fails because our plan details are out of date
    When the client decides whether to try again
    Then it retries

  # ============================================================================
  # Upgrade Modal: Limit Mode (Backward Compatibility)
  # ============================================================================

  @integration
  Scenario: Existing limit upgrade modal still works for non-SEAT_EVENT limits
    Given the organization has reached its team member limit
    When the upgrade modal opens for a limit enforcement
    Then I see "Upgrade Required" title
    And I see the limit type and current usage
    And I see a redirect button to the plan management page

  # ============================================================================
  # Upgrade Modal: Seats Mode (Proration Preview)
  # ============================================================================

  @integration
  Scenario: Seats mode modal shows the recurring total after a seat update
    Given I have triggered a seat update from 5 to 7 seats
    When the proration preview modal opens
    Then I see "Confirm Seat Update" title
    And I see current seats as 5 and new total seats as 7
    And I see the new recurring billing amount

  @integration
  Scenario: Seats mode modal shows the amount charged immediately
    Given I have triggered a seat update from 5 to 7 seats
    When the proration preview modal opens
    Then I see the prorated amount to be charged immediately
    And the recurring total is labeled with its billing period

  @integration
  Scenario: Seats mode modal presents a seat reduction as applying from the next cycle
    Given I have triggered a seat update that lowers the seat count
    When the proration preview modal opens
    Then nothing is due today
    And the new billing amount is labelled with the date it applies

  @integration
  Scenario: Seats mode modal splits VAT out of the amount charged today
    Given I have triggered a seat update whose charge today is €25.07, €4.35 of it VAT
    When the proration preview modal opens
    Then "Due today" reads "€25.07" with "€20.72 + €4.35 VAT" under it
    And the new billing amount says it excludes VAT

  # A per-line breakdown (the unused-time credit and the remaining-time charge
  # as separate rows) is still not rendered — the modal shows the net amount.
  @integration @unimplemented
  Scenario: Seats mode modal itemizes prorated credits and charges
    Given I have triggered a seat update from 5 to 7 seats
    When the proration preview modal opens
    Then I see line items showing credits and charges

  @integration
  Scenario: Seats mode modal shows loading state while fetching preview
    Given I have triggered a seat update
    When the proration preview modal opens
    And the preview data is loading
    Then I see a loading spinner in the modal body

  @integration
  Scenario: Seats mode modal shows error state on preview failure
    Given I have triggered a seat update
    When the proration preview modal opens
    And the preview query fails
    Then I see an error message in the modal
    And the "Confirm & Update" button is disabled

  @integration
  Scenario: Cancelling proration preview does nothing
    Given I have triggered a seat update from 5 to 7 seats
    And the proration preview modal is open
    When I click "Cancel"
    Then the modal closes
    And no seat update is executed

  # ============================================================================
  # Subscription Page: Trigger Proration Modal
  # ============================================================================

  @integration @unimplemented
  Scenario: Subscription page update uses plan maxMembers as base
    Given I am on the subscription page
    And the organization has an active Growth subscription with maxMembers 5
    And the organization has 3 accepted core members
    When I add 2 seats in the seat management drawer
    And I click "Update subscription"
    Then the proration preview modal opens with new total of 7 seats
    And the base is 5 (from maxMembers), not 3 (from member count)

  # ============================================================================
  # Members Page: Trigger Proration Modal
  # ============================================================================

  # ============================================================================
  # Business Logic: Seat Update Calculation
  # ============================================================================

  @unit @unimplemented
  Scenario: Seat update total uses subscription maxMembers as base
    Given a subscription with maxMembers 5
    And 3 current core members in the organization
    When calculating the new total for 2 additional seats
    Then the new total is 7 (maxMembers 5 + 2 seats available)

  # ============================================================================
  # Store: Discriminated Variant
  # ============================================================================
