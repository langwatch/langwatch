Feature: Model cost comparison, estimated savings against a reference model
  Teams running self-hosted or cheap models want to show the value of that
  choice: what would the same traffic have cost on a commercial model?
  The analytics page lets the user pick a reference model and see the
  actual spend next to the estimated spend on the reference model, using
  the period's real token counts and the reference model's catalog
  pricing. The difference is the estimated savings.

  A wrong cost figure is worse than no figure at all: it looks plausible,
  it gets quoted to a finance team, and nothing on screen says it is
  wrong. So the card prices exactly the token buckets the product bills,
  and declines to show a number whenever it cannot stand behind one.

  Background:
    Given a project with traffic in the selected period
    And the traffic carries input and output token counts

  Scenario: Comparing local traffic against a commercial reference model
    Given the period has 2,000,000 input tokens and 500,000 output tokens
    And the actual recorded cost for the period is $0
    When the user selects a reference model with catalog pricing
    Then the card shows the estimated cost for the same tokens on the reference model
    And the estimate is input_tokens x reference input price plus output_tokens x reference output price
    And the card shows the estimated savings (estimate minus actual cost)

  Scenario: Cached prompts are priced at the reference model's cache rates
    Given part of the period's prompts were served from the provider's cache
    And the cached tokens are recorded separately from the fresh input tokens
    When the card estimates the cost on the reference model
    Then the cached tokens are priced at the reference model's cache rates
    And they are not left out of the estimate

  Scenario: A reference model that publishes no cache rate
    Given the selected reference model publishes no cache rate
    When the card estimates the cost on it
    Then cached tokens are priced as fresh input, the same way the recorded cost is

  Scenario: The card shows what the estimate was computed from
    When the card shows an estimate
    Then it states the input, output and cached token counts behind it
    And the reader can check the figure against the period's usage

  Scenario: Comparison respects the page filters
    Given the user filtered the page by a label
    When the savings card computes token totals
    Then only traffic matching the filters is counted
    And changing the date range recomputes the comparison

  Scenario: Only models with a published price are offered as reference
    When the user opens the reference model selector
    Then models the catalog publishes no price for are not listed

  Scenario: Custom and self-hosted models are never offered as reference
    Given a custom or self-hosted model has been added to a provider
    When the user opens the reference model selector
    Then the custom model is not listed
    And it cannot be selected to produce a fabricated savings estimate

  Scenario: A reference model with no published price shows no estimate
    Given the selected reference model has no published price
    Then the card shows no estimated cost and no estimated savings
    And it explains that the period cannot be repriced with that model
    And it never presents the missing price as $0.00

  Scenario: Traffic that already costs more than the reference shows negative savings
    Given the actual recorded cost is higher than the reference estimate
    Then the card presents the difference as additional cost, not savings

  Scenario: No traffic in the period
    Given the filtered period has zero tokens
    Then the card shows an empty state instead of a $0.00 comparison

  Scenario: Usage has not loaded yet
    Given the usage for the period has not come back
    Then the card shows a loading state
    And it does not claim the period is empty before it has an answer

  Scenario: Usage could not be loaded
    Given the usage query failed
    Then the card says the usage could not be loaded
    And it does not present the failure as a quiet period

  Scenario: Actual cost for the period is genuinely zero
    Given the period has traffic and the actual recorded cost is $0
    Then the card shows $0.00 as the actual cost
    And it does not show "No data yet"
