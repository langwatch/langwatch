Feature: Subscription cancellation revokes access and sends correct notifications

  When a customer cancels their subscription, the platform must:
  - Revoke paid-tier access when cancellation becomes effective (e.g., at period end)
  - Not reactivate the subscription from $0 invoices generated during cancellation
  - Send correct notifications (not "activated" messages)

  Background:
    Given an organization with an active Growth Seat subscription
    And the subscription is linked to a Stripe subscription

  @regression @unit
  Scenario: $0 invoice on cancellation does not reactivate a cancelled subscription
    Given the subscription has been cancelled in our database
    When Stripe fires an invoice.payment_succeeded event for the cancelled subscription
    And the Stripe subscription status is "canceled"
    Then the webhook handler skips activation
    And no Slack notification is sent

  @regression @unit
  Scenario: $0 invoice on cancellation does not reactivate a cancelling subscription
    Given the subscription is still active in our database
    When Stripe fires an invoice.payment_succeeded event
    And the Stripe subscription status is "canceled"
    Then the webhook handler skips activation
    And no Slack notification is sent

  @regression @unit
  Scenario: Cancelled subscription resolves to free tier limits
    Given the subscription has been cancelled
    When the plan provider resolves the active plan for the organization
    Then free tier limits are returned
    And maxMembers equals 2
