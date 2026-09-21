Feature: Evaluator judge temperature on models that pin it
  As someone running an LLM-as-judge evaluator
  I want the judge to work on the model I picked for it
  So that the evaluation returns a verdict instead of a provider rejection

  # Evaluators default to temperature 0 for deterministic verdicts, and
  # gpt-5-family models accept only the default temperature (1), rejecting
  # every other value: "Unsupported value: 'temperature' does not support
  # 0.0 with this model. Only the default (1) value is supported."
  #
  # drop_params cannot cover this: it strips parameters a model does not
  # support at all, and these models do support temperature — they restrict
  # its value. Two evaluators carried their own guard for it
  # (llm_answer_match, select_best_compare); every other one, and every
  # user-configured judge model, failed before it started. The treatment now
  # lives in the litellm patch, which every litellm call passes through, so
  # it covers all of them at once. Those two guards are left in place as
  # redundant rather than removed — and the ragas path builds its call
  # through langchain instead, so it does not pass this seam and keeps
  # needing its own.
  #
  # Bindings:
  #   services/langevals/langevals_core/langevals_core/litellm_patch.py
  #   services/langevals/langevals_core/tests/test_gpt5_temperature_compatibility.py

  @unit
  Scenario: A judge pinned cold still reaches a model that only runs at its default temperature
    Given an evaluator whose judge asks for temperature 0
    And its model only accepts the default temperature
    When the evaluator asks that model to judge
    Then the request leaves at the model's only accepted temperature

  # The cost of the scenario above, stated rather than implied: the evaluator
  # asked for 0 to make its verdicts reproducible, and on such a model it
  # cannot have that. Overriding is still the better of the two, because the
  # alternative is no verdict at all — but a disagreement between two runs of
  # the same judge on a pinned model is not necessarily meaningful.
  @unit
  Scenario: A judge on a pinned model does not get the determinism it asked for
    Given an evaluator whose judge asks for temperature 0
    And its model only accepts the default temperature
    When the evaluator asks that model to judge
    Then the request leaves at a temperature the evaluator did not choose

  # The family name is the only signal available here, and it is not exact:
  # the image models in the same family do take a temperature.
  @unit
  Scenario: A model in the family that does accept a temperature keeps the one it was given
    Given an evaluator whose judge asks for temperature 0
    And its model is a gpt-5 image model, which accepts any temperature
    When the evaluator asks that model to judge
    Then the request leaves at the temperature the evaluator chose

  # An Azure deployment is named by whoever created it, so by the time the
  # request names the deployment there is nothing left to recognise.
  @unit
  Scenario: An Azure deployment of a pinned model is recognised by what the request asked for
    Given an evaluator whose judge asks for temperature 0
    And its model is a pinned model served by an Azure deployment with an unrelated name
    When the evaluator asks that model to judge
    Then the request leaves at the model's only accepted temperature

  # How the platform actually sends an evaluator's temperature: as a request
  # environment variable, merged into the call arguments before the model is
  # settled. A treatment applied before that merge would miss every real call.
  @unit
  Scenario: A temperature arriving as a request setting is normalized too
    Given an evaluator whose temperature arrives as a request setting
    When the evaluator asks a pinned-temperature model to judge
    Then the request leaves at the model's only accepted temperature

  @unit
  Scenario: Every other model keeps the temperature the evaluator chose
    Given an evaluator whose judge asks for temperature 0
    And its model accepts any temperature
    When the evaluator asks that model to judge
    Then the request leaves at the temperature the evaluator chose

  @unit
  Scenario: A call that never named a temperature is left alone
    Given an evaluator whose judge names no temperature
    When the evaluator asks a pinned-temperature model to judge
    Then the request leaves with no temperature at all
