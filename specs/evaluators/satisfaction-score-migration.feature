Feature: Migrate satisfaction score to sentiment evaluator
  As a platform operator
  I want sentiment analysis to be a standard evaluator in langevals
  So that it follows the same infrastructure as all other evaluators

  Background:
    The satisfaction score was previously computed by a reactor in the trace processing pipeline,
    calling out to langwatch_nlp's sentiment analysis endpoint. This is being migrated to a
    standalone "sentiment" evaluator in langevals/ so it can be used like any other evaluator.

    This is a breaking change - existing customers lose the automatic satisfaction score.
    They can re-enable it by configuring the new sentiment evaluator.

  @unit
  Scenario: Sentiment evaluator computes sentiment from input text
    Given an evaluator entry with input text
    When the evaluator runs
    Then it returns a score between -1 and 1
    And it returns a label of "positive" or "negative"

  @unit
  Scenario: Sentiment evaluator uses embedding similarity
    Given an evaluator entry with positive input text
    When the evaluator computes embeddings
    Then the positive similarity is higher than negative similarity
    And the final score is positive

  @integration
  Scenario: Analytics dashboard no longer shows satisfaction graph
    Given the analytics home dashboard
    When the page renders
    Then there is no satisfaction score graph section

  @unit
  Scenario: Trace processing pipeline no longer computes satisfaction score
    Given the trace processing pipeline
    When a new trace is ingested
    Then no satisfaction score reactor is triggered
    And no satisfaction score event is emitted
