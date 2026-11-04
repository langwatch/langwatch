Feature: What the Instant Evals judge costs us, and what the customer is charged

  As the platform
  I want one pricing rule for every Instant Evals judgement
  So that a run, a judged query and a judge call are priced the same way

  Two rules, chosen by whether a judgement carries a cost.
  Unrouted (ADR-174 decision 13, moved here from Instant Evals unchanged): input tokens at the
  classifier's published rate and markup, under the model jev.
  Routed (ADR-190): the summed cost of every call the route made, input and output tokens at
  deploy-time per-backend prices, at the same markup, under the model langwatch-judge. A judgement
  that carries a cost, including 0, is a routed one, and it names the input tokens that cost covers.
  A run or page costs its routed cost plus its other input tokens at the classifier's rate, so a run
  that mixes routed and unrouted calls is billed correctly.

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

  @unit
  Scenario: A routed judgement is priced from its summed cost, not its tokens
    Given a judgement that carries a routed cost of 0.003 dollars
    When its cost and price are computed
    Then the cost is 0.003 dollars and the price is that cost times the markup

  @unit
  Scenario: A routed judgement with a cost of zero is still routed
    Given a judgement that carries a routed cost of 0
    When its cost and price are computed
    Then the cost is 0 and its input tokens are not priced at the classifier's rate

  @unit
  Scenario: A judged query is held at the dearest rate a route can reach
    Given a route table whose enabled backends have different input rates
    When a judged query's budget hold is priced
    Then it is priced at the dearest base input rate any enabled backend or fallback reaches
    And never below the classifier's published rate, at the one markup
    And it is a best-effort hold, not a hard cap on what a routed query can spend

  @unit
  Scenario: A routed cost with no input tokens is still billed
    Given a routed judge call, run, page or judged query whose cost is above zero and whose input tokens are zero
    When its spend is recorded or checked against the budget
    Then it is billed at that cost times the markup, under the router's model and rate
    And a spend with neither input tokens nor a cost still records nothing

  @unit
  Scenario: Routed and unrouted tokens are billed separately
    Given a run whose judgements carry a routed cost for some of its input tokens
    When the run is priced
    Then the input tokens no routed cost covers are priced at the classifier's rate
    And the routed judgements are priced from their summed cost
    And the two are added
