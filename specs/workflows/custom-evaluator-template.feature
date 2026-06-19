Feature: Custom evaluator from workflow scaffold
  As a user creating a custom evaluator from a workflow
  I want a clean minimal starting scaffold
  So that I am not confused by sample fields, datasets and extra nodes

  # Customer context: the "custom evaluator from workflow" starter came with
  # a sample bias-detection dataset, extra entry fields (answer, unbiased,
  # bias_category) and a stray ExactMatch evaluator node, all of which
  # confused first-time users. The scaffold is now just an entry with a
  # single question, one sample LLM judge node, and an end node, wired
  # together.

  @unit
  Scenario: Custom evaluator template entry exposes only a question input
    Given the custom evaluator template
    Then the entry point has a single "question" output

  @unit
  Scenario: Custom evaluator template has no attached dataset
    Given the custom evaluator template
    Then the entry point has no attached dataset

  @unit
  Scenario: Custom evaluator template LLM input is named input
    Given the custom evaluator template
    Then the sample LLM node has a single input named "input"

  @unit
  Scenario: Custom evaluator template wires reasoning into the end details
    Given the custom evaluator template
    Then the LLM node "reasoning" output is connected to the end node "details"

  @unit
  Scenario: Custom evaluator template lists details first on the end node
    Given the custom evaluator template
    Then the end node results start with "details" so the reasoning edge does not cross the verdict edge

  @unit
  Scenario: Custom evaluator template has no extra ExactMatch evaluator
    Given the custom evaluator template
    Then the only nodes are the entry, the sample LLM node and the end node
