Feature: Internal Slack alert on subscription payment failure

  When Stripe reports a failed payment for a known subscription, the team must
  be alerted immediately in the billing Slack channel — today the first internal
  signal is the subscription deletion when Stripe exhausts dunning, potentially
  weeks later. The alert gives ops the context to act: which organization, which
  plan, how much failed in which currency, whether this is a repeat failure from
  an earlier dunning cycle, and direct links to the admin org page and the
  Stripe subscription.

  Stripe fires one invoice.payment_failed event per retry attempt, and retries
  of the same invoice can be days apart — elapsed time cannot distinguish a
  retry from a new failure. One alert per event is accepted (no dedup). The
  retry signal comes from the event itself: the invoice's attempt count says
  which attempt this is, and a previous failure recorded before the current
  invoice was created marks an earlier dunning cycle. Under concurrent
  deliveries the repeat signal is best-effort.

  Subscription status semantics on payment failure (ACTIVE stays ACTIVE,
  PENDING becomes FAILED, failure date recorded) are unchanged and remain
  covered by specs/features/webhook-service-refactor.feature — they are not
  re-specified here, except the new cancelled-subscription guard below.

  Background:
    Given an organization with a subscription linked to a Stripe subscription

  # --- Alert content ---

  @unit
  Scenario: Payment failure on a known subscription sends a payment-failed Slack alert
    Given the subscription is currently active
    When Stripe fires an invoice.payment_failed event for the subscription
    Then a payment-failed Slack notification is sent
    And the notification includes the organization name and plan
    And the notification links to the organization admin page
    And the notification links to the Stripe subscription using the Stripe subscription id

  @unit
  Scenario: Alert links to the test-mode Stripe dashboard for test-mode events
    Given the invoice.payment_failed event is a test-mode event
    When the payment failure is processed
    Then the Stripe subscription link points at the test-mode dashboard
    And the alert is labelled as test mode so it cannot be mistaken for a live incident

  @unit
  Scenario: Alert includes the failed amount in the invoice currency
    Given the invoice.payment_failed event carries an amount due of 3400 cents in "eur"
    When the payment failure is processed
    Then the payment-failed notification shows the amount formatted in euros

  @unit
  Scenario: Alert is still sent when the event payload lacks an invoice amount
    Given the invoice.payment_failed event payload carries no amount due
    When the payment failure is processed
    Then a payment-failed Slack notification is sent without an amount

  # --- Repeat-failure signal ---

  @unit
  Scenario: First payment failure signals no prior failure
    Given the subscription has no recorded payment failure
    When Stripe fires an invoice.payment_failed event for the subscription
    Then the payment-failed notification indicates there is no prior unresolved failure

  @unit
  Scenario: A retry of the same invoice is labelled by its attempt count, not as a repeat failure
    Given the subscription has a recorded payment failure from after the current invoice was created
    And the invoice.payment_failed event carries attempt count 3
    When the payment failure is processed
    Then the payment-failed notification shows this is attempt 3 for the invoice
    And the notification does not claim a failure from an earlier dunning cycle

  @unit
  Scenario: A failure with a prior failure from before the current invoice surfaces the previous failure date
    Given the subscription has a recorded payment failure from before the current invoice was created
    When Stripe fires another invoice.payment_failed event for the subscription
    Then the payment-failed notification shows the date of the previous failure
    And the previous failure date shown predates the current event

  # --- Cancelled subscriptions ---

  @unit
  Scenario: Late payment failure on a cancelled subscription is skipped without an alert
    Given the subscription is already cancelled in our database
    When Stripe fires an invoice.payment_failed event for the subscription
    Then the payment failure is not recorded on the subscription
    And the subscription status is not changed
    And no Slack notification is sent

  # --- Resilience ---

  @unit
  Scenario: Notification failure never fails the webhook
    Given assembling or sending the payment-failed notification throws
    When Stripe fires an invoice.payment_failed event for the subscription
    Then the payment failure is still recorded
    And the webhook handler completes successfully
    And the notification failure is logged by the handler

  @unit
  Scenario: Unknown subscription keeps warn-and-skip with no alert
    Given no subscription record exists for the Stripe subscription
    When Stripe fires an invoice.payment_failed event
    Then the handler logs a warning and skips processing
    And no Slack notification is sent
