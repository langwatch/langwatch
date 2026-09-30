Feature: LLM-as-judge tools ask for a justification, not for reasoning
  As someone running an LLM-as-judge evaluator on a Claude model
  I want the judge's structured answer to be accepted on every route
  So that the evaluation returns a verdict instead of a safeguard refusal

  # A judge benchmark ran the langevals boolean prompt through claude -p on
  # Sonnet 5.5 and Opus 5.5. The old wording ("write your thoughts on the
  # reasoning", "ponder") was refused by a reasoning-extraction safeguard on
  # 6 of 6 and 4 of 6 cases; asking for a justification from the evidence was
  # refused on none. The `reasoning` field keeps its name for the result schema.
  #
  # Bindings:
  #   services/langevals/tests/deterministic/test_llm_judge_justification_wording.py

  @unit
  Scenario: A judge tool asks for a justification, not for the model's reasoning
    Given an llm_boolean, llm_score or llm_category evaluator
    When the evaluator asks its model to judge
    Then the tool description and its field descriptions ask for a justification citing the evidence
    And none of them asks the model to write out its reasoning or thoughts

  @unit
  Scenario: The judge's answer keeps the schema its callers read
    Given an llm_boolean, llm_score or llm_category evaluator
    When the model answers with a justification in the `reasoning` field
    Then the evaluation is processed
    And the justification becomes the result details
