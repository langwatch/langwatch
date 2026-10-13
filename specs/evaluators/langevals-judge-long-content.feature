Feature: LLM-as-judge evaluators on content longer than the token budget
  As someone running an LLM-as-judge evaluator over long traces
  I want a verdict on the content even when it is longer than the judge can read
  So that long conversations are judged instead of silently skipped

  # The judge benchmark found 4.9% of real LLM-judge
  # cases over the 128k-token budget, and langevals skipped all of them. The
  # content is now cut to the budget keeping its opening and its ending, the
  # same rule as cutToEstimatedTokensKeepingEnds in @langwatch/trace-contract.
  #
  # Bindings:
  #   services/langevals/langevals_core/langevals_core/token_budget.py
  #   services/langevals/langevals_core/tests/test_token_budget.py
  #   services/langevals/tests/deterministic/test_llm_judge_long_content.py

  @unit
  Scenario: Content over the budget is judged with its middle cut
    Given an LLM-as-judge evaluator with a token budget
    And an output longer than that budget
    When the evaluator runs
    Then the judge receives the opening and the ending of the output
    And a marker between them says how many tokens were omitted from the middle
    And what the judge receives fits the budget
    And the evaluation reaches a verdict that says the content was cut

  @unit
  Scenario: Short fields stay whole and the long ones share what is left
    Given an input that fits easily and an output far over the budget
    When the evaluator fits the content to the budget
    Then the input reaches the judge unchanged
    And only the output is cut

  @unit
  Scenario: Content within the budget reaches the judge unchanged
    Given content that fits the token budget
    When the evaluator runs
    Then the judge receives the content exactly as given

  @unit
  Scenario: The budget is the smaller of the setting and the model's input window
    Given an evaluator whose max tokens setting is larger than its model's input window
    When the evaluator fits the content
    Then the content is cut to fit the model's input window

  # Only when the evaluator's own prompt leaves no room for any content is
  # there nothing to judge; that is reported, with the numbers, not guessed.
  @unit
  Scenario: A prompt that leaves no room for content is skipped with the reason
    Given an evaluator whose prompt alone fills the token budget
    When the evaluator runs
    Then the evaluation is skipped
    And the skip names the prompt's size and the budget
