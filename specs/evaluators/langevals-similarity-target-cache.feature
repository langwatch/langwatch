Feature: Semantic similarity embeds its fixed target text once per process
  As someone running the semantic similarity evaluator on many traces
  I want the fixed target text embedded once instead of on every call
  So that each evaluation costs one embedding request, not two

  # The target text comes from the evaluator settings and never changes between
  # entries, but the server builds a new evaluator for every request. A cache in
  # memory, scoped to the process, keeps its vector. Scores do not change.
  #
  # Bindings:
  #   services/langevals/evaluators/langevals/langevals_langevals/similarity.py
  #   services/langevals/evaluators/langevals/tests/test_similarity_cache.py

  @unit
  Scenario: The second call with the same target makes one embedding request
    Given the target text has already been embedded once
    When another entry is evaluated against the same target
    Then only the entry content is embedded

  @unit
  Scenario: Scores match embedding both texts every time
    Given two entries evaluated against the same target
    Then each score equals the score from embedding the target and the entry fresh

  @unit
  Scenario: A batch of entries embeds the target once
    Given a batch of ten entries and one target, evaluated in parallel
    When the batch is evaluated
    Then the target is embedded once and each entry is embedded once

  @unit
  Scenario: Different credentials embed the target again
    Given the target was embedded with one set of credentials
    When the same target is evaluated with other credentials
    Then the target is embedded again

  @unit
  Scenario: A different embeddings model embeds the target again
    Given the target was embedded with one embeddings model
    When the same target is evaluated with another embeddings model
    Then the target is embedded again

  @unit
  Scenario: Entry content is never cached
    Given the same entry content is evaluated twice
    Then the entry content is embedded both times

  @unit
  Scenario: The cache keeps digests, not text or credentials
    Given an evaluation with credentials in its request environment
    Then the cache key holds neither the target text nor the credentials

  @unit
  Scenario: A target over the token limit is skipped and not cached
    Given a target longer than the token limit
    When an entry is evaluated against it
    Then the evaluation is skipped
    And nothing is cached

  @unit
  Scenario: The cache is bounded and drops the least recently used entry
    Given a cache that holds a fixed number of entries
    When one more entry is added
    Then the least recently used entry is dropped
