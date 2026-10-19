Feature: What the Instant Evals judge costs us, and what the customer is charged

  As the platform
  I want one pricing rule for every Instant Evals judgement
  So that a run, a judged query and a judge call are priced the same way

  ADR-174 decision 13: the rule moved here from Instant Evals unchanged.
  The rate and the markup are the classifier's own published pricing.

  @unit
  Scenario: The cost is the tokens at the classifier's published rate
    Given a run of two million input tokens
    When the cost is computed
    Then it is the rate the classifier publishes for two million tokens

  @unit
  Scenario: The customer price is the cost at the published markup
    Given a run costing one dollar
    When the price is computed
    Then it is the cost times the markup the classifier publishes

  @unit
  Scenario: A priced amount is rounded to nano-USD precision
    Given a judgement of 211,727 input tokens
    When its cost and price are computed
    Then both are exact to the ledger's nano-USD unit and carry no float noise past it
