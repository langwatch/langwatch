Feature: What the Instant Evals judge costs us, and what the customer is charged

  As the platform
  I want one pricing rule for every Instant Evals judgement
  So that a run, a judged query and a judge call are priced the same way

  Two rules, chosen by whether a judgement carries a cost.
  Unrouted (ADR-174 decision 13, moved here from Instant Evals unchanged): input tokens at the
  classifier's published rate and markup, under the model langwatch-instant-preview.
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
  Scenario: An unrouted spend row names the product, never a backend
    Given an unrouted run's priced spend
    When its spend row is built
    Then its model is langwatch-instant-preview
    And it names no route table backend id

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
    Then it is priced at the dearest base input rate any enabled backend or fallback of a search or LLM-judge route reaches
    And never below the classifier's published rate, at the one markup
    And it holds an unrouted query; a routed query is held at its cost ceiling instead (ADR-190 decision 13)

  @unit
  Scenario: A scenario route's backends never raise a judged query's hold
    Given a route table whose scenario judging route reaches a backend dearer than any other
    When a judged query's budget hold is priced
    Then it is priced over the backends a search or LLM-judge route can reach, a gate's included
    And the scenario route's backend still needs a price to boot, since its judgements are billed

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

  @unit
  Scenario: Each call's tokens and cost are added to its judgement's spend
    Given a judgement's spend so far
    When one more call is added
    Then a priced call adds its input tokens and its tokens' cost at the backend's rates
    And an unpriced call adds its input tokens and no cost, and is flagged as unpriced
    And a call that billed no tokens changes nothing, priced or not
    And a call that billed output tokens alone still adds their cost
