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

  The customer price (ADR-174 decision 25) is our cost times 1.3, as before, unless the spend has
  rated input tokens. Rated tokens are the row's input tokens read once (its largest paid call),
  and a routed judgement has them only when a backend past Jev, a decision model or an LLM,
  answered it. Then the price is the rated tokens at the tier's published rate, output free, or
  our cost times 1.3 when that is higher, so no call loses money. The Evals tier, an LLM-judge
  call through Evals Preview, the judge router, is 0.60 USD per million rated input tokens; the
  Instant tier, Instant Evals spend past Jev, is 0.30 USD. Rates are before VAT.
  Unrouted spend, a routed call Jev alone answered, a caller's stop and every Instant Evals run,
  page and judged query today stay at the cost times 1.3: Instant Evals sends no route, and a run
  does not carry rated tokens. Rows already written keep the stamp and price they were written with.

  @unit
  Scenario: Only spend a backend past Jev answered has a published rate
    Given an Instant Evals spend and an LLM-judge call, each with and without rated input tokens
    When each one's published rate is chosen
    Then a spend with no rated tokens has none, so it is priced at the cost times 1.3
    And an Instant Evals spend with rated tokens is on the Instant tier
    And an LLM-judge call with rated tokens is on the Evals tier, Evals Preview
    And a routed judgement carries rated tokens only when a decision model or an LLM answered it

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
  Scenario: An unrouted call is priced at the cost times 1.3, with no published rate
    Given an unrouted Instant Evals run of 1,000,000 input tokens that cost us 0.042 USD
    And an unrouted LLM-judge call on Instant Preview of 500 input tokens that cost us 21,000 nano-USD
    When each is priced
    Then the run is 0.0546 USD and the judge call 27,300 nano-USD, the cost times 1.3
    And neither is priced at a published rate

  @unit
  Scenario: A routed call no backend past Jev answered is priced at the cost times 1.3
    Given an LLM-judge call the router answered with its Jev backend alone, or a kind it left to the classifier
    And a routed call the caller stopped after paid legs
    When each is priced
    Then it carries no rated tokens and is its summed cost times 1.3, not Evals Preview's rate
    And its priced fact is stamped instant_eval_judge_router@<route version>x1.3, naming no published rate

  @unit
  Scenario: A routed run carries no rated tokens and is priced at the cost times 1.3
    Given a routed Instant Evals run of 1,000,000 input tokens whose routed calls cost us 0.10 USD
    When it is priced
    Then the price is 0.13 USD, its cost times 1.3, since a run does not carry rated tokens
    And its priced fact is stamped instant_eval_judge_router@<route version>x1.3

  @unit
  Scenario: Instant Evals spend past Jev is priced at 0.30 USD per million input tokens
    Given an Instant Evals spend of 1,000,000 rated input tokens whose routed calls cost us 0.10 USD
    When it is priced
    Then the price is 0.30 USD, the Instant tier's rate, above the floor of 0.13 USD

  @unit
  Scenario: An LLM judge routed through Evals Preview is priced at 0.60 USD per million input tokens
    Given an LLM-judge call routed through Evals Preview of 1,000,000 rated input tokens whose routed calls cost us 0.20 USD
    When it is priced
    Then the price is 0.60 USD, above the floor of 0.26 USD

  @unit
  Scenario: A routed call whose cost times 1.3 is above the rate is priced at that floor
    Given a routed LLM-judge call of 1,000,000 rated input tokens whose routed calls cost us 0.50 USD
    And an Instant Evals spend of 1,000,000 rated input tokens whose routed calls cost us 0.25 USD
    When each is priced
    Then the judge call is 0.65 USD and the spend is 0.325 USD

  @unit
  Scenario: The published rate applies to the row's input tokens once
    Given an LLM-judge call whose decision model read the row's 2,000 input tokens
    And two of its questions escalated to an LLM, so its paid legs read 3,260 input tokens
    When it is priced
    Then its rated tokens are 2,000, so the rate side is 2,000 tokens at 0.60 USD per million, 0.0012 USD
    And the floor is every paid leg's summed cost times 1.3, which wins when it is higher

  @unit
  Scenario: Output tokens are free
    Given an unrouted LLM-judge call of 500 input tokens that also reported 200 output tokens
    And a routed LLM-judge call of 1,000,000 rated input tokens whose calls, output included, cost us 0.20 USD
    When each is priced
    Then the first is 27,300 nano-USD, its input tokens' cost times 1.3
    And the second is 0.60 USD, its rated tokens at the Evals tier's rate

  @unit
  Scenario: The rate version names a published rate only when one priced the spend
    Given an unrouted spend, a routed spend with no rated tokens and a routed spend with rated tokens
    When their priced facts are built
    Then they are stamped instant_eval@0.042x1.3 and instant_eval_judge_router@<route version>x1.3, as before
    And the rated one is stamped instant_eval_judge_router@<tier><rate>+<route version>x1.3, such as evals0.6
    And a row written under an older rate version keeps the stamp and the price it was written with

  @unit
  Scenario: The estimate is priced by the same rule as the run
    Given a statement matching 10,000 rows whose sampled request is 1,070 input tokens
    When the run is estimated, and an unrouted run that read the same 10,700,000 input tokens finishes
    Then the estimate and the finished run are both priced 0.58422 USD, the cost of 0.4494 USD times 1.3

  @unit
  Scenario: A priced amount is rounded to nano-USD precision
    Given a judgement of 211,727 input tokens
    When its cost and price are computed
    Then both are exact to the ledger's nano-USD unit and carry no float noise past it
    And its price is 0.011560294 USD

  @unit
  Scenario: A routed judgement is priced from its summed cost, not its tokens
    Given a judgement that carries a routed cost of 0.003 dollars
    When its cost and price are computed
    Then the cost is 0.003 dollars
    And the price is that cost times 1.3 when that is above its rated tokens at the tier's rate

  @unit
  Scenario: A routed judgement with a cost of zero is still routed
    Given a judgement that carries a routed cost of 0
    When its cost and price are computed
    Then the cost is 0 and its input tokens are not priced at the classifier's rate
    And the price is its rated tokens at the tier's published rate, or 0 when it has none

  @unit
  Scenario: A judged query is held at the dearest rate a route can reach
    Given a route table whose enabled backends have different input rates
    When a judged query's budget hold is priced
    Then it is priced at the dearest base input rate any enabled backend or fallback reaches
    And never below the classifier's published rate, at the one markup
    And a judged query sends no route and carries no rated tokens, so its charge is its cost times 1.3, never above the hold
    And it is a best-effort hold, not a hard cap on what a routed query can spend

  @unit
  Scenario: A routed cost with no input tokens is still billed
    Given a routed judge call, run, page or judged query whose cost is above zero and whose input tokens are zero
    When its spend is recorded or checked against the budget
    Then it is billed at that cost times 1.3, under the router's model and rate
    And a spend with neither input tokens nor a cost still records nothing

  @unit
  Scenario: Routed and unrouted tokens are billed separately
    Given a run whose judgements carry a routed cost for some of its input tokens
    When the run is priced
    Then the input tokens no routed cost covers are priced at the classifier's rate
    And the routed judgements are priced from their summed cost
    And the two are added
