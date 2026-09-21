Feature: Evaluator generation parameters reach the judge the same way on every path
  As someone configuring the model of an LLM-as-judge evaluator
  I want the temperature, max tokens and sampling parameters I saved to apply
  So that the same evaluator behaves the same in a scenario run, in the
  experiments workbench and on a monitor

  # The evaluator model editor saves temperature, max_tokens, top_p and the
  # other generation parameters into the evaluator settings. The evaluation
  # execution layer turns a whitelisted subset of them into X_LITELLM_*
  # request variables for the evaluator engine. Two dispatch paths reach it:
  # a scenario run forwards the raw settings, while the /api/evaluations
  # route (workbench, monitors, SDK) first parses the settings through the
  # evaluator's generated schema, which only declares the evaluator's own
  # fields. Until now that parse silently dropped every generation
  # parameter, so the same evaluator ran with them on one path and without
  # them on the other. A customer saw this as an evaluator that worked for
  # one colleague (workbench) and failed for another (scenario run).
  #
  # The app forwards what was configured and nothing more. Whether a model
  # accepts a value, or a pair of values, is the evaluator engine's concern:
  # see specs/evaluators/langevals-anthropic-sampling-compatibility.feature
  # and specs/evaluators/langevals-gpt5-temperature-compatibility.feature.
  #
  # Bindings:
  #   services/langevals/langevals_core (the Claude temperature/top_p rule)
  #   modules/evaluation (EvaluationModelEnv.resolveForEvaluator — declared, implementation still owed)

  @unit
  Scenario: Generation parameters survive the settings schema parse on the API route
    Given an evaluator whose settings carry a temperature and a top_p
    And the evaluator's settings schema declares neither
    When the settings are parsed for dispatch
    Then the parsed settings still carry the temperature and the top_p
    And a field the schema does not know and the whitelist does not name is dropped

  @unit
  Scenario: Configured generation parameters reach the evaluator engine
    Given an evaluator whose settings carry temperature 1, top_p 1 and max_tokens 64000
    When the request variables for the evaluator engine are built
    Then they carry the temperature, the top_p and the max_tokens as configured
    And a parameter outside the whitelist is not forwarded
