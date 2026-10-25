Feature: The Go evaluator runtime runs the ragas LLM metrics as ragas 0.4.3 did
  The eight judge-scored ragas metrics run in nlpgo: the prompt with its JSON
  schema in one user message, the repair loop, the temperatures and the score
  arithmetic, replayed against the calls langevals made.
  Plan: dev/docs/plans/langevals-go-replacement.md §8.2, §8.3.
  Reference: dev/docs/plans/langevals-go/ragas-0.4.3-reference.md.

  @unit
  Scenario: Each ragas LLM metric replays its recorded answers, prompts byte-identical
    Given the calls langevals made for each ragas LLM metric's recorded cases
    When each case runs through the Go runtime against those calls only
    Then every rendered prompt matches its recorded request byte for byte
    And every score is within 1e-9 of langevals' and every skip and error matches

  @unit
  Scenario: Malformed JSON from the model is repaired at most three times
    Given a judge model that never answers valid JSON
    When a ragas LLM metric runs
    Then the model is asked once and then for three repairs
    And the entry is an error, not a score

  @unit
  Scenario: A model answer cut off by the length limit aborts the metric
    Given a judge model that stops because it ran out of tokens
    When a ragas LLM metric runs
    Then the entry is an error
    And no repair or retry is asked for

  @unit
  Scenario: Response relevancy asks for three questions, and scores one when the provider returns one
    Given response relevancy's recorded cases
    When the metric runs
    Then it asks for three completions in one request
    And a provider that answers one completion is scored on that one

  @unit
  Scenario: Only rate limits are retried
    Given a judge model that first answers a rate limit
    When a ragas LLM metric runs
    Then the call is made again and the entry is scored
    But a server error is not retried and the entry is an error

  @unit
  Scenario: Metric prompts and entry content never reach a log or a LangWatch span
    Given a ragas LLM metric that scores an entry, and one that fails
    When their logs and LangWatch's own spans are read
    Then neither carries the entry's content or the prompts

  # Moved from the retired ragas-go-parity.feature: behaviours no scenario above binds yet.

  @unit @unimplemented
  Scenario Outline: A ragas string metric reproduces the recorded scores exactly
    Given the recorded cases for "<evaluator>"
    When the Go evaluator scores them
    Then every score is within 1e-9 of langevals'

    Examples:
      | evaluator               |
      | ragas/bleu_score        |
      | ragas/rouge_score       |
      | ragas/context_precision |
      | ragas/context_recall    |
      | ragas/context_f1        |

  @integration @unimplemented
  Scenario: A live ragas run stays within the spread langevals showed on the same sample
    Given the sample for a ragas LLM metric and the spread of three langevals runs on it
    When the Go evaluator scores the sample against the real judge model
    Then its mean score differs from langevals' mean by no more than that spread

  @unit @unimplemented
  Scenario: A ragas score that is not a number is reported as an error, not sent as NaN
    Given a context recall judgement that yields no countable verdicts
    When the Go context recall evaluator runs
    Then the entry's result is an error naming the empty judgement

  @unit @unimplemented
  Scenario: Response context precision judges against the expected output when both are given
    Given an entry with both an output and an expected output
    When the Go response context precision evaluator runs
    Then the contexts are judged against the expected output
