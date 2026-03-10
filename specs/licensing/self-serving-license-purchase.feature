Feature: Self-Serving License Purchase
  As a user wanting to run LangWatch self-hosted
  I want to purchase a license and receive it automatically
  So that I can activate my self-hosted deployment without manual intervention

  Background:
    Given the SaaS platform has a valid license signing private key configured
    And the Stripe license payment link is configured

  # Core webhook flow
  @integration
  Scenario: Generate and email license on successful Stripe purchase
    Given a user completes checkout via the license payment link with 5 seats
    When the Stripe checkout.session.completed webhook fires
    Then a GROWTH license is generated with maxMembers set to 5
    And all other plan limits are set to unlimited
    And the license expires 1 year from the purchase date
    And the license is emailed to the buyer's email address

  @integration
  Scenario: Route license purchase separately from subscription checkout
    Given a checkout.session.completed event with a payment_link matching the license payment link ID
    When the webhook handler processes the event
    Then the event is routed to the license generation flow
    And the subscription checkout flow is NOT executed

  @integration
  Scenario: Route subscription checkout normally when not a license purchase
    Given a checkout.session.completed event without a matching payment_link
    When the webhook handler processes the event
    Then the existing subscription checkout flow executes
    And the license generation flow is NOT triggered

  @integration
  Scenario: Default to 1 seat when quantity is missing
    Given a user completes checkout via the license payment link with no quantity specified
    When the Stripe checkout.session.completed webhook fires
    Then a GROWTH license is generated with maxMembers set to 1

  @integration
  Scenario: Use business name as organization name in license
    Given a user completes checkout with business name "Acme Corp" and email "buyer@acme.com"
    When the license is generated
    Then the license organization name is "Acme Corp"
    And the license email is "buyer@acme.com"

  @integration
  Scenario: Fall back to email when business name is empty
    Given a user completes checkout with no business name and email "buyer@solo.dev"
    When the license is generated
    Then the license organization name is "buyer@solo.dev"

  # Slack notification
  @integration
  Scenario: Notify Slack channel on license purchase
    Given the Slack license webhook URL is configured
    When a license is successfully generated from a purchase
    Then a Slack notification is sent with buyer email, plan type, seat count, and amount paid

  @integration
  Scenario: Continue license delivery when Slack notification fails
    Given the Slack license webhook URL is configured but unreachable
    When a license is successfully generated from a purchase
    Then the license is still emailed to the buyer
    And the Slack failure is logged but does not block delivery

  # Error handling
  @integration
  Scenario: Handle missing private key gracefully
    Given the license signing private key is NOT configured
    When a license purchase webhook fires
    Then the webhook logs an error about missing private key
    And the webhook returns a 500 status
    And no email is sent

  @integration
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
