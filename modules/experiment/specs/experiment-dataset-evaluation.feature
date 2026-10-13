Feature: Experiment runs the SDK's dataset evaluation
  `POST /api/dataset/evaluate` answers under experiment, path, body limit,
  statuses, bodies, permission and operation id unchanged. Experiment resolves
  the experiment slug itself and asks evaluation for the evaluator, the dataset,
  the run, the cost and the row, so evaluation holds no experiment dependency
  (peer cut EV, step 2b).

  @unit
  Scenario: The dataset evaluation door keeps its wire after the move
    Given the dataset evaluation REST family mounted by experiment
    When the declaration is read
    Then it answers POST /api/dataset/evaluate at its literal address and its /api/v1 twin, in dataset's namespace
    And it keeps the operation id postApiDatasetEvaluate, asks evaluations:manage and caps the body at 30MB

  @unit
  Scenario: A dataset evaluation's experiment slug resolves through the experiment owner
    Given a dataset evaluation names an experiment by slug
    When the evaluator has run over the entry
    Then its cost and its batch-evaluation row are recorded against that experiment's id
    And a slug the project does not hold is refused as not found after the run

  @unit
  Scenario: A dataset evaluation refuses what it cannot run with main's status and body
    Given the dataset evaluation door
    When the body is not JSON, names no evaluator, lacks a required field, carries invalid data or names no dataset
    Then each answers the status and body it answered while evaluation served it
    And a run that throws is answered as an errored result, not a refusal
