Feature: Experiment serves an experiment's batch-evaluation records
  The batchRecord namespace answers under experiment, names, inputs, outputs and
  permissions unchanged. Experiment resolves the slug to its own experiment and asks
  dataset for the rows by id; dataset holds no experiment dependency (Alex, 2026-10-07, D2).

  @unit
  Scenario: The batchRecord procedures keep their wire after the move
    Given the batchRecord tRPC surface mounted by experiment
    When the declaration is read
    Then it answers under the batchRecord namespace with getAllByexperimentIdGroup and getAllByexperimentSlug
    And both keep workflows:view

  @unit
  Scenario: An experiment's batch-evaluation records are read by its slug
    Given an experiment with the slug "nightly"
    When the batch-evaluation records of "nightly" are asked for
    Then experiment asks dataset for the rows of that experiment's id

  @unit
  Scenario: A slug no experiment has is refused
    Given a project with no experiment by the slug "ghost"
    When the batch-evaluation records of "ghost" are asked for
    Then the read is refused with experiment_not_found and dataset is not asked

  @unit
  Scenario: The batch-evaluation rollup is answered by dataset through experiment
    When the batch-evaluations index asks for a project's rollup
    Then experiment answers dataset's rollup unchanged
