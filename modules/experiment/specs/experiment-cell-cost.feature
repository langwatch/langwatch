Feature: A cell's cost prices cached prompt tokens at the cache rates

  The workflow engine reports a node's prompt tokens with the cached tokens
  included, and the cached counts beside them. Experiment takes the cached
  tokens out of the fresh input and prices each count once, so a mostly-cached
  prompt never costs as much as an uncached one.

  @unit
  Scenario: Cached prompt tokens are priced at the cache-read rate
    Given a model whose cache-read rate is lower than its input rate
    When a cell reports 10000 prompt tokens of which 9000 were cached
    Then its cost is lower than that of a cell with 10000 uncached prompt tokens

  @unit
  Scenario: Cached tokens are not priced twice
    Given a model with distinct input, cache-read and cache-write rates
    When a cell reports 10000 prompt tokens of which 8000 were read and 1000 written to the cache
    Then its cost is 1000 input, 8000 cache-read and 1000 cache-write tokens at their own rates

  @unit
  Scenario: A prompt total smaller than its cache counts is kept whole
    Given a model with distinct input and cache-read rates
    When a cell reports 500 prompt tokens and 800 cache-read tokens
    Then its cost is 500 input tokens plus 800 cache-read tokens at their own rates

  @unit
  Scenario: A cell with only cached tokens is still priced
    Given a cell that reports no prompt or completion tokens and some cached tokens
    When the cell is priced
    Then the price is looked up

  @unit
  Scenario: A cell with no tokens of any kind is left unpriced
    Given a cell whose metrics report every count as zero
    When the cell is priced
    Then no price is looked up
