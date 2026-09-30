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
