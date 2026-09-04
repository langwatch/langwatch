Feature: Python SDK tracks a GEPA optimizer run in Experiments
  As a developer optimizing a DSPy program with GEPA
  I want langwatch.dspy.init(experiment=..., optimizer=dspy.GEPA(...)) to record the run
  So that every candidate GEPA scores on the validation set shows up as a step in Experiments

  Background: one tracked class per optimizer.
    `langwatch.dspy.init` swaps the class of the optimizer it receives for a
    LangWatchTracked subclass that logs one step per evaluation. GEPA joins
    BootstrapFewShot, BootstrapFewShotWithRandomSearch, COPRO and MIPROv2 in
    that map. GEPA reports its progress through the callback protocol of the
    `gepa` package, and `on_valset_evaluated` fires once for the seed program
    and once for every candidate that reaches a full validation pass, with the
    candidate's instructions per predictor, the average score and the score
    and output of every validation example. A GEPA metric is called with up
    to five positional arguments (gold, pred, trace, pred_name, pred_trace)
    and may return a `dspy.Prediction` carrying `score` and `feedback`.

  @unit
  Scenario: init recognises a GEPA optimizer
    Given a dspy.GEPA optimizer
    When langwatch.dspy.init is called with it as the optimizer
    Then the optimizer becomes a LangWatchTrackedGEPA
    And the "assuming custom optimizer tracking" notice is not printed

  @unit
  Scenario: The tracked metric keeps the feedback GEPA reads
    Given a metric that returns dspy.Prediction(score=0.5, feedback="too many steps")
    When the tracked GEPA calls the metric for a validation example
    Then the caller receives the same Prediction with its score and feedback
    And the example, the prediction and the score 0.5 are buffered for the next step

  @unit
  Scenario: A feedback call for one predictor is not buffered as an example
    Given a metric wrapped by the tracked GEPA
    When GEPA calls the metric with a pred_name to collect feedback for that predictor
    Then the metric result is returned unchanged
    And no example is buffered, because the same example was already buffered by the evaluation

  @unit
  Scenario: compile installs the GEPA callback and keeps the ones the caller passed
    Given a tracked GEPA created with gepa_kwargs={"callbacks": [my_callback]}
    When compile runs
    Then gepa.optimize receives my_callback followed by the LangWatch callback
    And after compile the optimizer's gepa_kwargs are the ones the caller passed

  @unit
  Scenario: Records a step per candidate evaluated on the validation set
    Given a tracked GEPA compiling a program with predictors "agent.react" and "agent.extract.predict"
    When GEPA evaluates candidate 2 on the validation set with average score 0.83
    Then a step with index "2", score 0.83 and label "score" is sent under the optimizer name "GEPA"
    And the step's predictors carry the candidate's instructions for each predictor, with the signature fields of the program
    And the step's optimizer parameters include max_metric_calls and reflection_minibatch_size

  @unit
  Scenario: The step's examples are the validation results of that candidate
    Given a validation set of three examples
    When GEPA evaluates a candidate and reports the score and output of each validation example
    Then the step carries exactly three examples, each with its example fields, its prediction and its score
    And the examples buffered by minibatch evaluations before that step are discarded

  @unit
  Scenario: The seed program's step takes its examples from the metric buffer
    Given GEPA evaluates the seed program on the validation set without reporting outputs
    When on_valset_evaluated fires for iteration 0
    Then the step's examples are the ones the tracked metric buffered during that evaluation

  @unit
  Scenario: log_step still drains the buffer for the custom optimizer path
    Given examples buffered through track_metric
    When log_step is called without examples
    Then the step carries the buffered examples and the buffer is empty afterwards
