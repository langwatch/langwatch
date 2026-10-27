Feature: Evaluator judge sampling on models that accept only one sampling knob
  As someone running an LLM-as-judge evaluator
  I want the judge to work on the model I picked for it
  So that the evaluation returns a verdict instead of a provider rejection

  # Anthropic's current Claude models reject a request that names both
  # sampling knobs: "`temperature` and `top_p` cannot both be specified for
  # this model. Please use only one." An evaluator configured with both — a
  # temperature for determinism and a top_p someone once set alongside it —
  # fails before it starts, on every entry.
  #
  # drop_params cannot cover this: each parameter is supported on its own,
  # and litellm strips only what a model does not support at all. The
  # restriction here is on the combination, so one of the two has to give
  # way, and which one is a choice this spec states rather than hides.
  #
  # Bindings:
  #   services/langevals/langevals_core/langevals_core/litellm_patch.py
  #   services/langevals/langevals_core/tests/test_anthropic_sampling_compatibility.py

  @unit
  Scenario: A judge asking for both sampling knobs still reaches a model that accepts only one
    Given an evaluator whose judge asks for a temperature and a top_p
    And its model rejects a request naming both
    When the evaluator asks that model to judge
    Then the request leaves with only one sampling knob

  # The choice, stated rather than implied: the temperature survives and the
  # top_p is dropped. Evaluators default to temperature 0 for reproducible
  # verdicts, so the temperature is the knob their determinism actually
  # lives in; a top_p riding alongside it is the one whose absence changes
  # a verdict least.
  @unit
  Scenario: The temperature is the knob that survives
    Given an evaluator whose judge asks for a temperature and a top_p
    And its model rejects a request naming both
    When the evaluator asks that model to judge
    Then the request leaves at the temperature the evaluator chose
    And the request leaves with no top_p at all

  # How the platform actually sends an evaluator's sampling settings: as
  # request environment variables, merged into the call arguments before the
  # model is settled. A treatment applied before that merge would miss every
  # real call.
  @unit
  Scenario: A top_p arriving as a request setting conflicts all the same
    Given an evaluator whose top_p arrives as a request setting
    When the evaluator asks a one-knob model to judge with a temperature
    Then the request leaves with no top_p at all

  # The model is recognised by its name wherever the route puts it, because
  # the same model refuses the combination whether it is reached directly,
  # through Bedrock, or through Vertex.
  @unit
  Scenario: A Claude model is recognised behind any provider route
    Given an evaluator whose judge asks for a temperature and a top_p
    And its model is a Claude model reached through a cloud provider route
    When the evaluator asks that model to judge
    Then the request leaves with no top_p at all

  @unit
  Scenario: Either knob alone is delivered as given
    Given an evaluator whose judge asks for only one sampling knob
    When the evaluator asks a one-knob model to judge
    Then the request leaves with the knob the evaluator chose

  @unit
  Scenario: Every other model keeps both knobs
    Given an evaluator whose judge asks for a temperature and a top_p
    And its model accepts both together
    When the evaluator asks that model to judge
    Then the request leaves with both knobs the evaluator chose
