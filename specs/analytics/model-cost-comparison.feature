Feature: Model cost comparison — estimated savings against a reference model
  Teams running self-hosted or cheap models want to show the value of that
  choice: what would the same traffic have cost on a commercial model?
  The analytics page lets the user pick a reference model and see the
  actual spend next to the estimated spend on the reference model, using
  the period's real token counts and the reference model's catalog
  pricing. The difference is the estimated savings.

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

  Scenario: Comparison respects the page filters
    Given the user filtered the page by a label
    When the savings card computes token totals
    Then only traffic matching the filters is counted
    And changing the date range recomputes the comparison

  Scenario: Only models with catalog pricing are offered as reference
    When the user opens the reference model selector
    Then models without pricing in the catalog are not listed

  Scenario: Custom and self-hosted models are never offered as reference
    Given a custom or self-hosted model has been added to a provider
    When the user opens the reference model selector
    Then the custom model is not listed, even though it has placeholder pricing
    And it cannot be selected to produce a fabricated savings estimate

  Scenario: Traffic that already costs more than the reference shows negative savings
    Given the actual recorded cost is higher than the reference estimate
    Then the card presents the difference as additional cost, not savings

  Scenario: No traffic in the period
    Given the filtered period has zero tokens
    Then the card shows an empty state instead of a $0.00 comparison

  Scenario: Actual cost for the period is genuinely zero
    Given the period has traffic and the actual recorded cost is $0
    Then the card shows $0.00 as the current cost
    And it does not show "No data yet"
