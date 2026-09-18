Feature: What an Instant Eval run costs, and what the customer is charged

  As the platform
  I want a run's spend recorded once, priced the same way everywhere
  So that the estimate a caller reads before a run and the bill after it come from one rule

  Issue: Instant Evals, PR 4. ADR-137.

  The shape:
  - The run accumulates the tokens each page reported and writes one cost row at the end.
  - The rate and the markup are the classifier's own published pricing, never a constant
    held by the run.
  - Metering through Stripe and the free budget are not in this change. What is here is the
    recorded cost, the customer price beside it, and the two row caps.

  @unit
  Scenario: A run's tokens are the sum of what its pages reported
    Given two pages reporting eight hundred and twelve hundred input tokens
    When the run finishes
    Then its token total is two thousand

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

  @integration
  Scenario: A run that judged nothing writes no cost row
    Given a run whose statement matched no rows
    When it finishes
    Then no cost row is written

  @integration
  Scenario: The cost row names the run it belongs to
    Given a finished run
    When its cost row is read
    Then the row's type and reference type are the Instant Eval ones
    And its reference is the run's own id

  @unit
  Scenario: A cost that cannot be written is retried, not dropped
    Given a run whose cost row write fails
    When it finishes
    Then the failure is raised so the finish is delivered again
    And the retry writes the same cost row rather than a second one
