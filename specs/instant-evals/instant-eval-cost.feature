Feature: What an Instant Eval run costs, and what the customer is charged

  As the platform
  I want a run's spend reported once, priced the same way everywhere
  So that the estimate a caller reads before a run and the bill after it come from one rule

  Issue: Instant Evals, PR 4. ADR-153.

  The shape:
  - The run accumulates the tokens each page reported and reports one spend record at the
    end; a synchronous query reports one when it finishes.
  - The rate and the markup are the classifier's own published pricing, never a constant
    held by the run.
  - The spend goes through the InstantEvalSpendRecorder port. The recorder that meters it
    against the customer's budget is bound by the gateway spend pipeline; the default
    binding logs the record and meters nothing. What is here is the record, the cost and
    the customer price on the run's own row, and the two row caps.

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

  @unit
  Scenario: A priced amount is rounded to nano-USD precision
    Given a judgement of 211,727 input tokens
    When its cost and price are computed
    Then both are exact to the ledger's nano-USD unit and carry no float noise past it

  @unit
  Scenario: A run that judged nothing reports no spend
    Given a run whose statement matched no rows
    When it finishes
    Then no spend record is reported

  @unit
  Scenario: A finished run reports its spend once
    Given a run that judged a thousand texts
    When it finishes
    Then exactly one spend record is reported for the run
    And it names the project and the run
    And it carries the input tokens, the requests, our cost, the customer price and when it happened

  @unit
  Scenario: A spend that cannot be recorded is retried, not dropped
    Given a run whose spend recorder fails
    When it finishes
    Then the failure is raised so the finish is delivered again
    And the retry reports the same record rather than a second one

  @unit
  Scenario: The cost and the price stay on the run's row
    Given a finished run
    When its row is read
    Then it carries the tokens, our cost and the customer price the finish reported
