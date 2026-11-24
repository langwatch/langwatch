Feature: What the Instant Evals judge costs us, and what the customer is charged

  As the platform
  I want one pricing rule for every Instant Evals judgement
  So that a run, a judged query and a judge call are priced the same way

  Our cost has two rules, chosen by whether a judgement carries a cost.
  Unrouted (ADR-174 decision 13): input tokens at the classifier's rate, under the model
  langwatch-instant-preview.
  Routed (ADR-190): the summed cost of every call the route made, input and output tokens at
  deploy-time per-backend prices, under the model langwatch-judge. A judgement that carries a cost,
  including 0, is a routed one, and it names the input tokens that cost covers. A run or page costs
  its routed cost plus its other input tokens at the classifier's rate, so a run that mixes routed
  and unrouted calls is billed correctly.

  The customer price has one rule (ADR-174 decision 25): the input tokens at the tier's published
  rate, output free, or our cost times 1.3 when that is higher, so no call loses money. The Instant
  tier is Instant Evals runs, pages and judged queries, at 0.30 USD per million input tokens. The
  Evals tier is an LLM-judge evaluator's judge call, at 0.60 USD per million. Rates are before VAT.
  A row or call is priced as a whole: a run's rate and floor are its summed tokens and cost.

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
  Scenario: An Instant tier call is priced at 0.30 USD per million input tokens
    Given an Instant Evals run of 1,000,000 input tokens that cost us 0.042 USD
    When it is priced
    Then the price is 0.30 USD, not the cost times 1.3 of 0.0546 USD

  @unit
  Scenario: An Evals tier call is priced at 0.60 USD per million input tokens
    Given an LLM-judge evaluator's judge call of 1,000,000 input tokens that cost us 0.042 USD
    When it is priced
    Then the price is 0.60 USD

  @unit
  Scenario: A call whose cost times 1.3 is above the rate is priced at that floor
    Given an Evals tier judge call of 1,000,000 input tokens whose routed calls cost us 0.50 USD
    And an Instant tier run of 1,000,000 input tokens whose routed calls cost us 0.25 USD
    When each is priced
    Then the judge call is 0.65 USD and the run is 0.325 USD

  @unit
  Scenario: Output tokens are free at the published rate
    Given an Evals tier judge call of 500 input tokens that also reported 200 output tokens
    And a routed Evals tier judge call of 1,000,000 input tokens whose calls, output included, cost us 0.20 USD
    When each is priced
    Then the first is 0.0003 USD and the second 0.60 USD: input tokens at the rate, output at nothing

  @unit
  Scenario: The rate version names the tier's rate and the floor
    Given an unrouted Instant tier run, an unrouted Evals tier judge call and a routed Evals tier judge call
    When their priced facts are built
    Then they are stamped instant_eval@instant0.3+0.042x1.3, instant_eval@evals0.6+0.042x1.3 and instant_eval_judge_router@evals0.6+<route version>x1.3
    And a row written under an older rate version keeps the stamp and the price it was written with

  @unit
  Scenario: The estimate is priced by the same rule as the run
    Given a statement matching 10,000 rows whose sampled request is 1,070 input tokens
    When the run is estimated, and a run that read the same 10,700,000 input tokens finishes
    Then the estimate and the finished run are both priced 3.21 USD

  @unit
  Scenario: A priced amount is rounded to nano-USD precision
    Given a judgement of 211,727 input tokens
    When its cost and price are computed
    Then both are exact to the ledger's nano-USD unit and carry no float noise past it
    And an Instant tier price of it is 0.0635181 USD

  @unit
  Scenario: A routed judgement is priced from its summed cost, not its tokens
    Given a judgement that carries a routed cost of 0.003 dollars
    When its cost and price are computed
    Then the cost is 0.003 dollars
    And the price is that cost times 1.3 when that is above its input tokens at the tier's rate

  @unit
  Scenario: A routed judgement with a cost of zero is still routed
    Given a judgement that carries a routed cost of 0
    When its cost and price are computed
    Then the cost is 0 and its input tokens are not priced at the classifier's rate
    And the price is its input tokens at the tier's published rate

  @unit
  Scenario: A judged query is held at the dearest rate a route can reach
    Given a route table whose enabled backends have different input rates
    When a judged query's budget hold is priced
    Then it is priced at the dearest base input rate any enabled backend or fallback reaches
    And never below the classifier's rate, at the one markup
    And not at the Instant tier's published rate, since the default 4,000,000-token hold would then be 1.20 USD, above the free dollar
    And it is a best-effort hold, not a hard cap on what a routed query can spend

  @unit
  Scenario: A routed cost with no input tokens is still billed
    Given a routed judge call, run, page or judged query whose cost is above zero and whose input tokens are zero
    When its spend is recorded or checked against the budget
    Then it is billed at that cost times 1.3, under the router's model and rate, since no input token is priced at the rate
    And a spend with neither input tokens nor a cost still records nothing

  @unit
  Scenario: Routed and unrouted tokens are billed separately
    Given a run whose judgements carry a routed cost for some of its input tokens
    When the run is priced
    Then the input tokens no routed cost covers are priced at the classifier's rate
    And the routed judgements are priced from their summed cost
    And the two are added
    And the run's price is all its input tokens at the Instant tier's rate, or that cost times 1.3 when higher
