Feature: Self-Serving License Purchase

  # The @unimplemented scenarios cover Stripe-webhook-router dispatch of
  # checkout.session.completed and the purchase error paths (missing private
  # key, unreachable Slack, missing email config); none has a bound test yet.

  As a user wanting to run LangWatch self-hosted
  I want to purchase a license and receive it automatically
  So that I can activate my self-hosted deployment without manual intervention

  Background:
    Given the SaaS platform has a valid license signing private key configured
    And the Stripe license payment link is configured

  # Core webhook flow

  @integration @unimplemented
  Scenario: Route license purchase separately from subscription checkout
    Given a checkout.session.completed event with a payment_link matching the license payment link ID
    When the webhook handler processes the event
    Then the event is routed to the license generation flow
    And the subscription checkout flow is NOT executed

  @integration @unimplemented
  Scenario: Route subscription checkout normally when not a license purchase
    Given a checkout.session.completed event without a matching payment_link
    When the webhook handler processes the event
    Then the existing subscription checkout flow executes
    And the license generation flow is NOT triggered

  @integration
  Scenario: Use business name as organization name in license
    Given a user completes checkout with business name "Acme Corp" and email "buyer@acme.com"
    When the license is generated
    Then the license organization name is "Acme Corp"
    And the license email is "buyer@acme.com"

  @integration @unimplemented
  Scenario: Continue license delivery when Slack notification fails
    Given the Slack license webhook URL is configured but unreachable
    When a license is successfully generated from a purchase
    Then the license is still emailed to the buyer
    And the Slack failure is logged but does not block delivery

  # Yearly renewal of a licence subscription
  @unit
  Scenario: Renewal of a licence subscription mints the next term's licence
    Given a subscription bought through the license payment link
    When Stripe reports its yearly renewal invoice as paid with 7 seats for a period ending on 2028-01-01
    Then a GROWTH license for 7 seats expiring on 2028-01-01 is generated
    And it is recorded in the license registry, emailed to the buyer and announced on Slack

  @unit
  Scenario: Renewal of a licence subscription bought before renewals were handled
    Given a subscription whose checkout session came through the license payment link
    And billing holds no record of that subscription
    When Stripe reports its yearly renewal invoice as paid
    Then the renewed license is generated and emailed

  @unit
  Scenario: A redelivered renewal invoice mints nothing more
    Given the renewal license for an invoice was already delivered
    When Stripe delivers an event for the same invoice again
    Then no second license is generated and no second email is sent

  @unit
  Scenario: A failed renewal delivery is retried by Stripe
    Given sending the renewal license email fails
    When Stripe retries the same invoice event
    Then the renewal license minted on the first attempt is emailed on the retry
    And no second license is minted for the invoice

  @unit
  Scenario: Renewal of a subscription not bought through the license payment link is untouched
    Given a subscription whose checkout session came through another payment link
    When Stripe reports its renewal invoice as paid
    Then no license is generated
    And the subscription invoice flow runs as before

  @unit
  Scenario: Renewal of a LangWatch Cloud subscription asks Stripe nothing extra
    Given a subscription billing already holds as a LangWatch Cloud plan
    When Stripe reports its renewal invoice as paid
    Then no checkout session is looked up and no license is generated

  @unit
  Scenario: The first invoice of a licence subscription is not a renewal
    Given a subscription bought through the license payment link
    When Stripe reports its first invoice, with billing reason subscription_create, as paid
    Then no renewal license is generated

  @integration
  Scenario: Only one delivery claims a renewal invoice
    Given two deliveries of the same paid renewal invoice
    When both claim the invoice in billing's store
    Then only the first holds the claim
    And once it is delivered a later claim finds it delivered

  # Error handling
  @integration @unimplemented
  Scenario: Handle missing private key gracefully
    Given the license signing private key is NOT configured
    When a license purchase webhook fires
    Then the webhook logs an error about missing private key
    And the webhook returns a 500 status
    And no email is sent

  @integration @unimplemented
  Scenario: Handle missing email configuration gracefully
    Given the email sender is NOT configured
    When a license purchase webhook fires
    Then the license is generated but email delivery fails
    And the error is logged

  # GROWTH plan template
  @integration
  Scenario: GROWTH plan includes all features with no artificial limits
    Given a user purchases a GROWTH license with 10 seats
    When the license is generated
    Then the license plan type is "GROWTH"
    And the license allows 10 members
    And all other features are unlimited
    And publishing is enabled

  # UI: configurable payment link
  @integration
  Scenario: Purchase button uses configured payment link URL
    Given the STRIPE_LICENSE_PAYMENT_LINK_URL is set to "https://buy.stripe.com/test123"
    When the license page renders for a user without a license
    Then the "Purchase license" button links to "https://buy.stripe.com/test123"

  @integration
  Scenario: Purchase button hidden when payment link URL is not configured
    Given the STRIPE_LICENSE_PAYMENT_LINK_URL is NOT set
    When the license page renders for a user without a license
    Then the "Purchase license" button is not displayed
