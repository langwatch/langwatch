Feature: Where an organization can go next

  A growth line in a transactional message is a claim about one organization's
  money, and every way of getting it wrong looks the same from inside a
  template. A plan-to-price map quotes the list at somebody who negotiated. An
  annual variant reads as a rung above the monthly plan it is the same as. A
  tier that only a person sells reads as one the reader could buy this
  afternoon.

  So the decision is made once, from the organization's own plan and its own
  pricing model, and every message that names a plan, a price or a ceiling asks
  for it rather than deciding for itself. There are three answers: a plan the
  organization can buy, the people who hold its contract, or nothing.

  Background:
    Given the catalogue of plans sold self-serve

  @unit
  Scenario: A tiered organization is offered the next rung and its price
    Given an organization on a tiered plan below the top rung
    When its next step is resolved
    Then the rung above it is named with its monthly price

  @unit
  Scenario: An organization at the top of its ladder is offered nothing
    Given an organization already on the top rung of its ladder
    When its next step is resolved
    Then no plan and no account team is named

  @unit
  Scenario: An annual variant is the same rung as its monthly plan
    Given an organization on the annual variant of a rung
    When its next step is resolved
    Then it is treated as being on that rung rather than on an unknown plan

  @unit
  Scenario: A plan is quoted in the organization's own currency
    Given an organization quoted in euro
    When its next step is resolved
    Then the price comes back in euro

  @unit
  Scenario: A seat-and-event organization is offered the seat plan per person
    Given an organization on the seat and event pricing below the seat plan
    When its next step is resolved
    Then the seat plan is named and the price is marked as per person

  @unit
  Scenario: Every currency cut of the seat plan is the same rung
    Given an organization already on one currency cut of the seat plan
    When its next step is resolved
    Then no plan above it is named

  @unit
  Scenario: A legacy enterprise organization is never quoted a public price
    Given an organization on the legacy tiered enterprise plan
    When its next step is resolved
    Then its account team is named instead of a plan

  @unit
  Scenario: A new-pricing enterprise organization is never quoted a public price
    Given an organization on enterprise under the seat and event pricing
    When its next step is resolved
    Then its account team is named instead of a plan

  @unit
  Scenario: A licensed organization is never quoted a public price
    Given an organization whose plan came from a licence
    When its next step is resolved
    Then its account team is named instead of a plan

  @unit
  Scenario: An organization with negotiated limits is never quoted a public price
    Given an organization whose plan carries an override on its own limits
    When its next step is resolved
    Then its account team is named instead of a plan

  @unit
  Scenario: An organization on a plan nobody sells self-serve is never quoted a price
    Given an organization on a plan type that is on no ladder we sell
    When its next step is resolved
    Then its account team is named instead of a plan
