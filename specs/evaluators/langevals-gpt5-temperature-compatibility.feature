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
  # user-configured judge model, failed before it started. The treatment
  # lives centrally in the litellm patch so it covers all of them at once.
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
    And the evaluation reaches a verdict

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
