Feature: Ragas evaluators keep their scores when they move to Go
  As someone comparing RAG evaluation runs over time
  I want the Go Ragas evaluators to score as ragas 0.4.3 did
  So that moving off Python does not show up as a regression in my history

  # No Go ragas exists; the port is ragas 0.4.3's prompts copied verbatim, its
  # parsing and repair loop, and its arithmetic, for all 13 ragas evaluators.
  # Source of truth: dev/docs/plans/langevals-go/ragas-0.4.3-reference.md.
  # The recording holds every raw judge request and answer Python made on a
  # fixed sample (repairs, multiple completions, embeddings), so replay is
  # deterministic and needs no Python. Token-limit skips stay bound in
  # ragas-max-tokens.feature.

  # ============================================================================
  # Replay: exact
  # ============================================================================

  @unit @unimplemented
  Scenario Outline: An LLM metric reproduces the recorded scores exactly on replay
    Given the recording for "<evaluator>"
    When the Go evaluator scores the sample with the recorded answers
    Then every score matches the recorded one to within 1e-9
    And every skip matches the recorded skip reason

    Examples:
      | evaluator                        |
      | ragas/faithfulness               |
      | ragas/factual_correctness        |
      | ragas/response_context_recall    |
      | ragas/response_context_precision |
      | ragas/response_relevancy         |
      | ragas/summarization_score        |
      | ragas/rubrics_based_scoring      |
      | ragas/sql_query_equivalence      |

  @unit @unimplemented
  Scenario Outline: A string metric reproduces the recorded scores exactly
    Given the recording for "<evaluator>"
    When the Go evaluator scores the sample
    Then every score matches the recorded one to within 1e-9

    Examples:
      | evaluator               |
      | ragas/bleu_score        |
      | ragas/rouge_score       |
      | ragas/context_precision |
      | ragas/context_recall    |
      | ragas/context_f1        |

  @unit @unimplemented
  Scenario: Every judge prompt is rendered as ragas rendered it
    Given the recording for every LLM metric
    When the Go evaluators render their judge prompts for the sample
    Then each rendered user message is byte-identical to the recorded one

  @unit @unimplemented
  Scenario: A prompt the recording never saw fails the replay
    Given the recording for "ragas/faithfulness"
    When the Go evaluator renders a judge prompt the recording does not contain
    Then the replay fails naming the unmatched prompt

  # ============================================================================
  # Live: within Python's own spread
  # ============================================================================

  @integration @unimplemented
  Scenario: A live run stays within the spread Python showed on the same sample
    Given the sample for an LLM metric and the spread of three Python runs on it
    When the Go evaluator scores the sample against the real judge model
    Then its mean score differs from Python's mean by no more than that spread

  # ============================================================================
  # Behaviour a naive port loses
  # ============================================================================

  @unit @unimplemented
  Scenario: Unparseable judge output is repaired, then fails
    Given a judge model that answers with invalid JSON every time
    When a Go ragas evaluator runs
    Then it asks for a repair up to 3 times
    And the entry's result is an error, not a zero score

  @unit @unimplemented
  Scenario: A truncated judge answer is not repaired
    Given a judge model that stops because it ran out of tokens
    When a Go ragas evaluator runs
    Then the entry's result is an error
    And no repair is attempted

  @unit @unimplemented
  Scenario: A faithfulness answer with no statements is skipped
    Given a response the judge breaks into no statements
    When the Go faithfulness evaluator runs
    Then the entry is skipped rather than scored 0

  @unit @unimplemented
  Scenario: A score that is not a number is reported as an error, not sent as NaN
    Given a context recall judgement that yields no countable verdicts
    When the Go context recall evaluator runs
    Then the entry's result is an error naming the empty judgement

  @unit @unimplemented
  Scenario: A summary with no answerable questions is an error, not a crash
    Given a summarisation judgement that yields no answers
    When the Go summarisation evaluator runs
    Then the entry's result is an error naming the empty answers

  @unit @unimplemented
  Scenario: Context precision prefers the expected output when both are given
    Given an entry with both an output and an expected output
    When the Go response context precision evaluator runs
    Then the contexts are judged against the expected output
