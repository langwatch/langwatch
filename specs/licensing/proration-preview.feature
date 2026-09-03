Feature: Proration Preview Before Seat Update

  # All scenarios in this file describe the Seat-update proration-preview
  # modal on the Subscription page (loading state, error state, calculation
  # base, cancel behavior). The previewProration backend method is unit tested
  # in packages/enterprise/features/billing/server/src/__tests__/seatEventSubscription.unit.test.ts;
  # the modal itself is covered by
  # [gone] src/components/__tests__/UpgradeModal.integration.test.tsx.

  As a Growth plan (SEAT_EVENT) administrator
  I want to see the prorated charges before confirming a seat update
  So that I understand exactly what I'll be charged immediately before committing

  Seat upgrades are charged immediately (not deferred to the next invoice).
  The proration preview shows the exact amount that will be invoiced at the
  moment the update is confirmed.

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
  Scenario: Reducing seats previews a credit rather than an amount owed
    When I preview a seat decrease
    Then the amount due is negative

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
  # and the provider's, so a subscription set up by hand never has one and no
  # amount of waiting produces it.
  @unit
  Scenario: An active subscription with no billing-provider link is named as such
    Given the organization's active subscription has no billing-provider link
    When I preview a seat change
    Then the failure is reported as a subscription that is not linked
    And the failure is not reported as details that will catch up on their own

  @unit
  Scenario: An unlinked subscription blocks the seat update itself
    Given the organization's active subscription has no billing-provider link
    When I confirm a seat update
    Then the update fails rather than reporting success
    And no seat change is sent to the billing provider

  # A cancelled subscription keeps its provider link on purpose, so a churned
  # subscription is a permanent record. Ranking candidates by recency alone let
  # that record answer for an organization whose live plan was never linked.
  @unit
  Scenario: A cancelled subscription does not mask an unlinked active one
    Given the organization has a cancelled subscription that kept its link
    And the organization's active subscription has no billing-provider link
    When I preview a seat change
    Then the failure is reported as a subscription that is not linked

  # Nothing in checkout produces two live plans on one account — the backoffice
  # form does, writing any status against any organization with no uniqueness
  # check behind it. The row that still carries a provider link is not reliably
  # the one meant to survive, so charging it is a coin flip against a card.
  @unit
  Scenario: Two active subscriptions refuse a seat change rather than picking one
    Given the organization has two active subscriptions
    When I preview or confirm a seat change
    Then the change is refused as an account we cannot tell apart
    And nothing is sent to the billing provider

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
  Scenario: Seats mode modal presents a seat reduction as a credit
    Given I have triggered a seat update that lowers the seat count
    When the proration preview modal opens
    Then the amount is presented as a credit rather than as an amount owed

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

