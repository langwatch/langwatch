Feature: Billing ops functions
  A staff session reads an organization's billing state, the platform's subscription counts and
  the Stripe price catalogue through billing's own API. Answers carry ids, plan and state codes,
  counts and times; no card, invoice link, customer name or Stripe key leaves billing.
  ADR-202, amendment 2026-11-25.

  Background:
    Given cloud ops is on and the system flag "ops_agent_access_enabled" is on
    And the organization "ACME" exists

  @integration
  Scenario: org.billing answers the organization's subscription state
    Given ACME holds a cancelled Growth subscription and an active seat subscription
    And ACME is on the seat-and-event pricing model
    When an "org:metadata" session on ACME calls "org.billing"
    Then it answers the active subscription's id, plan, state, start and seat counts
    And it counts ACME's subscriptions by state
    And it says whether a failed payment is being recovered and since when

  @integration
  Scenario: org.billing answers an organization that never subscribed
    Given ACME holds no subscription
    When an "org:metadata" session on ACME calls "org.billing"
    Then it answers state "none", no subscription id and no counts

  @integration
  Scenario: org.billing reads only the approved organization
    Given Globex holds an active subscription
    When an "org:metadata" session on ACME calls "org.billing"
    Then the answer names ACME and none of Globex's subscriptions

  @integration
  Scenario: A billing function refuses by name off LangWatch Cloud
    Given a self-hosted deployment, where billing runs no subscriptions
    When a session calls "org.billing", "billing.subscriptions" or "billing.stripe_prices"
    Then each is refused 403 with "billing_facts_unavailable"
    And the trail row records the code

  @integration
  Scenario: billing.subscriptions counts subscriptions created in a range by plan and state
    Given three subscriptions created this month for two organizations and one created last month
    When an "ops:read" session calls "billing.subscriptions" since the start of the month
    Then it answers one row per plan and state with the subscriptions, the activated ones and the organizations
    And the one created last month is not counted

  @integration
  Scenario: billing.subscriptions takes at most 31 days
    When an "ops:read" session calls "billing.subscriptions" over 40 days
    Then it is refused with "staff_function_bad_input"

  @integration
  Scenario: billing.stripe_prices answers the catalogue with its tax behaviour
    Given the Stripe account holds a seat price billed tax exclusive and a retired price
    When an "ops:read" session calls "billing.stripe_prices"
    Then it answers each price's id, catalogue name, currency, amount, interval, tax behaviour and whether it is active
    And a lookup key outside the catalogue reads as "other"

  @unit
  Scenario: billing.stripe_prices refuses where no payment provider is configured
    Given LangWatch Cloud with no Stripe key
    When an "ops:read" session calls "billing.stripe_prices"
    Then it is refused 403 with "billing_facts_unavailable"

  @unit
  Scenario: billing.stripe_prices refuses a catalogue larger than its page walk
    Given the Stripe account holds more than 5,000 prices
    When an "ops:read" session calls "billing.stripe_prices"
    Then it is refused with "billing_price_catalogue_too_large" rather than answered in part

  @unit
  Scenario: billing.stripe_prices refuses by name when Stripe is unreachable or slow
    Given Stripe does not answer a price page within 10 seconds, or rate-limits the read
    When an "ops:read" session calls "billing.stripe_prices"
    Then it is refused 503 with "billing_provider_unavailable"

  @unit
  Scenario: Unknown plan, state and tax values read as other
    Given a subscription row whose plan or state billing does not know
    When billing answers its facts
    Then the plan and state read "other"
    And a tax behaviour Stripe adds later reads "other"
