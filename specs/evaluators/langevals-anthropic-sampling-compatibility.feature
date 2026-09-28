Feature: Evaluator judge sampling parameters on Claude models
  As someone running an LLM-as-judge evaluator on a Claude model
  I want the judge call to reach the model
  So that the evaluation returns a verdict instead of a provider rejection

  # Claude models from Opus 4.1, Sonnet 4.5 and Haiku 4.5 onwards refuse a
  # request that names both temperature and top_p: "`temperature` and
  # `top_p` cannot both be specified for this model. Please use only one."
  # The evaluator model editor writes every parameter it shows, so a judge
  # saved through it carries temperature 1 and top_p 1 together, both at the
  # provider default, and every call on such a model fails before it starts.
  #
  # drop_params cannot cover this: it strips parameters a model does not
  # support at all, and Claude supports each of the two on its own. The
  # treatment lives in the litellm patch, which every litellm call passes
  # through, including the ragas path (its langchain shim calls
  # litellm.completion). Temperature wins, which is what the AI gateway
  # already does for the same pair (refineTopP in param_policy.go).
  #
  # Bindings:
  #   services/langevals/langevals_core/langevals_core/litellm_patch.py
  #   services/langevals/langevals_core/tests/test_anthropic_sampling_compatibility.py

  @unit
  Scenario: A judge configured with both temperature and top_p still reaches a Claude model
    Given an evaluator whose judge names both a temperature and a top_p
    And its model is a Claude model
    When the evaluator asks that model to judge
    Then the request leaves with the temperature
    And the request leaves without top_p

  @unit
  Scenario: A Claude judge configured with top_p alone keeps it
    Given an evaluator whose judge names a top_p and no temperature
    And its model is a Claude model
    When the evaluator asks that model to judge
    Then the request leaves with that top_p

  @unit
  Scenario: A Claude model served by another provider gets the same treatment
    Given an evaluator whose judge names both a temperature and a top_p
    And its model is a Claude model served through Bedrock or Vertex
    When the evaluator asks that model to judge
    Then the request leaves without top_p

  @unit
  Scenario: A judge on a model that accepts the pair keeps both
    Given an evaluator whose judge names both a temperature and a top_p
    And its model is not a Claude model
    When the evaluator asks that model to judge
    Then the request leaves with both parameters
