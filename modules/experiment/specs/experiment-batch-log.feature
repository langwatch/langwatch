Feature: Experiment records the SDK's batch result log
  `POST /api/evaluations/batch/log_results` answers under experiment, path, body
  limits, statuses, permission and operation id unchanged. Experiment writes the
  batch into its own run history and reports each verdict to evaluation, so
  evaluation holds no experiment run dependency (peer cut EV, step 2).

  @unit
  Scenario: The batch log door keeps its wire after the move
    Given the batch log REST family mounted by experiment
    When the declaration is read
    Then it answers POST /api/evaluations/batch/log_results at its literal address and its /api/v1 twin
    And it keeps the operation id postApiEvaluationsBatchLogResults and asks evaluations:manage

  @unit
  Scenario: An SDK batch is written into its experiment's run history and its verdicts reported to evaluation
    Given an SDK logs a batch of evaluation results
    Then the experiment is found or created, and its run is started, filled and completed in that order
    And an evaluator result carries the status the batch reported
    And each verdict is reported to evaluation's processing pipeline

  # One SDK batch of results is sized to carry one dataset row with its images
  # inline: about 267 MB unless the organization's file limit was raised.

  @unit
  Scenario: A batch of results within the organization's limit is accepted
    Given an organization that sets no file limit of its own
    When an SDK reports a batch of results smaller than one full dataset row
    Then the batch is accepted

  @unit
  Scenario: A batch of results above the organization's limit is refused by name
    Given an organization that sets no file limit of its own
    When an SDK reports a batch of results larger than one full dataset row
    Then the batch is refused as "evaluation_log_results_too_large"
    And the refusal carries the organization's limit

  @unit
  Scenario: An organization with a raised file limit reports a batch the default limit refuses
    Given an organization whose file limit was raised
    When an SDK reports a batch larger than the default limit and smaller than its own
    Then the batch is accepted

  @unit
  Scenario: The batch log route reads a body up to the largest limit any organization holds
    Given the route that receives SDK batches has no project in reach when it reads the body
    Then it reads a body up to the largest limit an organization can be raised to
    And a body past that is refused as "evaluation_log_results_too_large"
