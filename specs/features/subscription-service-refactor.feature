Feature: Subscription service refactor
  The EESubscriptionService class produces identical results to the
  existing createSubscriptionService factory. Both coexist; the router
  continues using the old factory until Part 4.

  # Parity status: 0 of 6 scenarios bound to existing tests.
  # The remaining are tracked under #3458:
  #   - 5 NO_TEST: behavior shipped + correct, no integration test yet exists
  #   - 1 UPDATE: implementation diverged from the spec wording — needs scenario rewrite
  # NO_TEST gaps:
  #   - "EESubscriptionService updates subscription items via Stripe"
  #   - "EESubscriptionService creates checkout for new subscription"
  #   - "EESubscriptionService cancels subscription when downgrading to free"
  #   - "EESubscriptionService creates billing portal session"
  #   - "EESubscriptionService notifies for prospective subscription"
  # UPDATE divergences:
  #   - "New class implements the same interface as old factory"

  @unit @unimplemented
  Scenario: New class implements the same interface as old factory
    Given the SubscriptionService interface in app-layer
    When EESubscriptionService.create() is called with identical dependencies
    Then it returns an object satisfying the SubscriptionService interface

  @unit @unimplemented
  Scenario: EESubscriptionService updates subscription items via Stripe
    Given an organization with an active subscription
    When updateSubscriptionItems is called with new member and trace counts
    Then the Stripe subscription is updated with calculated items
    And the method returns success true

  @unit @unimplemented
  Scenario: EESubscriptionService creates checkout for new subscription
    Given an organization with no existing subscription
    When createOrUpdateSubscription is called with a paid plan
    Then a pending subscription record is created
    And a Stripe checkout session is created
    And the checkout URL is returned

  @unit @unimplemented
  Scenario: EESubscriptionService cancels subscription when downgrading to free
    Given an organization with an active subscription
    When createOrUpdateSubscription is called with FREE plan
    Then the Stripe subscription is cancelled
    And the subscription status is updated to CANCELLED

  @unit @unimplemented
  Scenario: EESubscriptionService creates billing portal session
    Given a customer ID and organization
    When createBillingPortalSession is called
    Then a Stripe billing portal session is created
    And the portal URL is returned

  @unit @unimplemented
  Scenario: EESubscriptionService notifies for prospective subscription
    Given an existing organization
    When notifyProspective is called with plan and contact details
    Then a prospective notification event is dispatched

