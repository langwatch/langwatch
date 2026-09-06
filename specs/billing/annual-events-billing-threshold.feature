Feature: Annual subscriptions collect event overage during the year

  A customer on an annual plan accrues metered event usage for twelve months
  and, without intervention, pays for all of it in a single renewal invoice.
  For a high-volume customer that renewal can be thousands of dollars in one
  charge — a payment profile far more likely to be declined than the same
  amount collected in slices as it accrues.

  # Stripe billing thresholds solve this without touching the plan: once a
  # threshold amount is set on the subscription, Stripe invoices and charges
  # the accrued metered amount automatically every time it crosses the line.
  # The annual included-events quota keeps its cumulative semantics across
  # threshold invoices, and the billing anniversary never moves.
  #
  # Stripe Checkout cannot set this field at subscription creation (the
  # parameter is rejected), so the platform applies it right after checkout
  # completes, from the webhook that already links the new subscription.
  #
  # This covers new subscriptions only. Existing annual subscriptions need a
  # one-time backfill over live Stripe billing data, which is SaaS-only
  # operational work and lives in the langwatch-saas task runner, not here.

  Background:
    Given the platform bills Growth plans as a seat item plus a metered events item

  @unit
  Scenario: An annual subscription gets a billing threshold after checkout completes
    Given a customer completes checkout for an annual Growth plan
    When the checkout completion webhook is processed
    Then the Stripe subscription is updated with a billing threshold of 750 in the subscription currency
    And the billing cycle anchor is not reset by threshold invoices

  @unit
  Scenario: A monthly subscription is left without a billing threshold
    Given a customer completes checkout for a monthly Growth plan
    When the checkout completion webhook is processed
    Then no billing threshold is set on the Stripe subscription

  @unit
  Scenario: A failure setting the threshold never fails the checkout
    Given a customer completes checkout for an annual Growth plan
    And the Stripe threshold update fails
    When the checkout completion webhook is processed
    Then the subscription is still linked and activated
    And the failure is logged for manual follow-up

  # Checkout completion answers Stripe with a success either way, so Stripe's
  # own redelivery never retries this failure. Without an alert the customer
  # silently keeps the single-large-invoice behaviour the threshold removes.
  @unit
  Scenario: A threshold failure raises an alert for manual follow-up
    Given a customer completes checkout for an annual Growth plan
    And the Stripe threshold update fails
    When the checkout completion webhook is processed
    Then the billing team is alerted with the subscription and the reason
    And checkout still completes even when the alert cannot be delivered

  @unit
  Scenario: Applying the threshold twice is a no-op
    Given an annual subscription that already carries the billing threshold
    When the threshold is applied again
    Then no Stripe update call is made

  @unit
  Scenario: A manually configured threshold amount is never replaced
    Given an annual subscription whose threshold was set by hand to a different amount
    When the threshold is applied
    Then the existing amount is preserved and no Stripe update call is made

  @unit
  Scenario: A threshold configured to move the billing anniversary is corrected
    Given an annual subscription whose threshold resets the billing cycle anchor
    When the threshold is applied
    Then the anchor reset is turned off while the existing amount is kept
