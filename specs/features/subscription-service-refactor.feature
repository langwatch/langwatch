Feature: Subscription service refactor
  The EESubscriptionService class produces identical results to the
  existing createSubscriptionService factory. Both coexist; the router
  continues using the old factory until Part 4.

  @unit
  Scenario: New class implements the same interface as old factory
    Given the SubscriptionService interface in app-layer
    When EESubscriptionService.create() is called with identical dependencies
    Then it returns an object satisfying the SubscriptionService interface

  @unit
  Scenario: EESubscriptionService updates subscription items via Stripe
    Given an organization with an active subscription
    When updateSubscriptionItems is called with new member and trace counts
    Then the Stripe subscription is updated with calculated items
    And the method returns success true

  @unit
  Scenario: EESubscriptionService creates checkout for new subscription
    Given an organization with no existing subscription
    When createOrUpdateSubscription is called with a paid plan
    Then a pending subscription record is created
    And a Stripe checkout session is created
    And the checkout URL is returned

  @unit
  Scenario: EESubscriptionService cancels subscription when downgrading to free
    Given an organization with an active subscription
    When createOrUpdateSubscription is called with FREE plan
    Then the Stripe subscription is cancelled
    And the subscription status is updated to CANCELLED

  @unit
  Scenario: EESubscriptionService creates billing portal session
    Given a customer ID and organization
    When createBillingPortalSession is called
    Then a Stripe billing portal session is created
    And the portal URL is returned

  @unit
  Scenario: EESubscriptionService notifies for prospective subscription
    Given an existing organization
    When notifyProspective is called with plan and contact details
    Then a prospective notification event is dispatched

  @unit
  Scenario: NullSubscriptionService throws on Stripe-dependent methods
    Given the NullSubscriptionService for self-hosted deployments
    When any Stripe-dependent method is called
    Then SubscriptionServiceUnavailableError is thrown

  @unit
  Scenario: NullSubscriptionService returns null for queries
    Given the NullSubscriptionService for self-hosted deployments
    When getLastNonCancelledSubscription is called
    Then null is returned

  @unit
  Scenario: Old factory remains unchanged
    Given the existing createSubscriptionService factory
    Then it continues to be exported and used by the subscription router
    And no existing tests break
