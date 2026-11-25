Feature: Ragas evaluators honor the configured max tokens
  As someone running a Ragas evaluator over long contexts
  I want the max tokens I set on the evaluator to be the entry size limit
  So that an entry within that limit is evaluated instead of skipped

  # Every Ragas evaluator skips an entry whose input, output and contexts add
  # up to more tokens than the evaluator's max_tokens setting. The check
  # used to cap that setting at 16384 regardless of what was configured, a
  # leftover from models with a 16k window. A customer set 64000 on a model
  # that takes it, saw "Total tokens exceed the maximum of 16384" on entries
  # of 23k tokens, and could not tell where the 16384 came from. The
  # LLM-as-judge evaluators never had this cap: they bound the setting by the
  # shared MAX_TOKENS_HARD_LIMIT, and Ragas now does the same. The platform
  # already clamps the setting to the model's own output ceiling before it
  # reaches the evaluator.
  #
  # Bindings:
  #   services/langevals/evaluators/ragas/langevals_ragas/lib/common.py
  #   services/langevals/evaluators/ragas/tests/test_max_tokens.py

  @unit
  Scenario: An entry within the configured max tokens is evaluated
    Given a Ragas evaluator configured with max_tokens 64000
    And an entry of 23000 tokens
    When the entry size is checked
    Then the entry is not skipped

  @unit
  Scenario: An entry over the configured max tokens is skipped with the configured limit in the reason
    Given a Ragas evaluator configured with max_tokens 64000
    And an entry of 70000 tokens
    When the entry size is checked
    Then the entry is skipped
    And the reason names 64000 as the maximum

  @unit
  Scenario: The shared hard limit still bounds the setting
    Given a Ragas evaluator configured with a max_tokens above the shared hard limit
    And an entry above the shared hard limit
    When the entry size is checked
    Then the entry is skipped
    And the reason names the shared hard limit as the maximum

  # The check is only as good as what it is handed. Three evaluators counted
  # the answer and the reference but not the question or the contexts their
  # scorer also reads, and for a RAG entry the contexts are most of the
  # payload. An under-counted entry passes the guard and then fails at the
  # judge, which is the opposite of the skip the guard exists to produce.
  @unit
  Scenario: Every Ragas evaluator counts the payload its scorer reads
    Given a Ragas evaluator whose scorer reads the question and the contexts
    When the entry size is checked
    Then the question and the contexts are counted towards the total
