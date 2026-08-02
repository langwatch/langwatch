Feature: A license adds capability without taking any away, and seats are what it meters

  A self-hosted deployment with no license runs on the open-source baseline,
  where seats, lite seats and message volume are all uncapped. Activating a
  license must not withdraw a capability the deployment already had, so the
  license-resolved plan is floored at that baseline.

  Seats are the deliberate exception. A self-hosted Enterprise license is priced
  per seat, so the seat count in the signed payload is what the customer bought
  and it binds: a ten-seat license refuses the eleventh member. Flooring seats
  would make every seat clause in every self-hosted contract unenforceable by
  the product, because the unlicensed baseline is uncapped and any finite number
  is therefore lower than it.

  Nothing else on self-hosted is sold by quantity. Message volume is not metered
  there at all, the data never leaves the customer's own database, and
  publishing is part of the open-source floor. A license may not withdraw
  either.

  The floor is a self-hosted policy. On Cloud a license is the negotiated
  contract and overrides the Stripe subscription in both directions, so the
  composite provider is deliberately left alone.

  As an operator of a self-hosted LangWatch deployment
  I want a license to add the Enterprise surface and meter my seats
  So that I am billed for what I use without losing anything I already had

  Background:
    Given a self-hosted deployment
    And an organization "org-123" exists

  @unit
  Scenario: The seat count a license sells is enforced
    Given the organization has a valid Enterprise license
    And the signed payload encodes 10 members and 5 lite members
    When the active plan is resolved
    Then the plan allows 10 members
    And the plan allows 5 lite members
    And the plan is still identified as Enterprise

  @unit
  Scenario: A license encoding a finite message volume resolves to the uncapped baseline
    Given the organization has a valid Enterprise license
    And the signed payload encodes 10000000 messages per month
    When the active plan is resolved
    Then the plan allows at least as many messages per month as the open-source baseline

  @unit
  Scenario: A license that withholds publishing does not remove it
    Given the organization has a valid license
    And the signed payload sets canPublish to false
    When the active plan is resolved
    Then the plan still allows publishing

  @unit
  Scenario: The seat guard stays armed on a licensed deployment
    Given the organization has a valid Enterprise license
    When the active plan is resolved
    Then adding members is still subject to the plan's limits

  @unit
  Scenario: Plan identity survives the floor
    Given the organization has a valid Enterprise license
    When the active plan is resolved
    Then the plan type, name and paid status come from the license
    And the plan source is reported as "license"

  @unit
  Scenario: A deployment with no license still resolves to the baseline
    Given the organization has no license stored
    When the active plan is resolved
    Then the plan is the open-source baseline
    And the plan source is reported as "free"
