Feature: A trace's total tokens count its cache reads and writes

  LangWatch keeps a span's input tokens as the fresh input, the part the
  prompt cache did not serve, with the cache reads and cache writes in their
  own buckets, so each token is priced once at its own rate. A trace's total
  tokens are every token its model calls processed: the fresh input, the
  output, and the cache reads and writes. The trace list, the trace header,
  conversation groups, token filters and sorting, and the analytics total
  tokens metric all use that one total. Costs are unchanged.

  Background:
    Given two Claude calls in one trace, each with 15 fresh input and 22 output tokens
    And the first wrote 15217 tokens to the prompt cache and the second read them

  @bdd @trace-processing @token-totals @unit
  Scenario: The trace list and the trace header show the total with the cache
    When the trace is listed and opened
    Then its total tokens are 30508
    And its input tokens are the 30 fresh tokens

  @bdd @trace-processing @token-totals @unit
  Scenario: Filtering and sorting by tokens use the total with the cache
    When traces are filtered or sorted by tokens
    Then the trace is compared at 30508 tokens

  @bdd @trace-processing @token-totals @unit
  Scenario: A conversation's total tokens add up its traces' totals with the cache
    When the trace's conversation is listed as a group
    Then the group's total tokens include the cache reads and writes

  @bdd @trace-processing @token-totals @unit
  Scenario: The analytics total tokens metric counts the cache
    When a chart asks for total tokens from trace summaries, the per-minute rollup or the slim table
    Then each source sums input, output, cache read and cache write tokens

  @bdd @trace-processing @token-totals @unit
  Scenario: The token breakdown names the fresh input when a cache was used
    When the token breakdown is shown for the trace
    Then the input row reads "Uncached input" and the rows add up to the total
