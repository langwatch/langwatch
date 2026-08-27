Feature: The previous configurations of a scope, read back from the runs
  As a person opening the run dialog
  I want every configuration this scope already ran with
  So that I can repeat one without rebuilding the dialog field by field

  Background: why the plan rows cannot answer this.
    The Run name dropdown lists the previous configurations of the current
    scope. A configuration is the scope, the targets, the repeat count, the two
    simulation models and the run parameters.

    Configuration identity is WIDER than plan identity. One plan run twice with
    different parameters, or with a different repeat count, is two
    configurations and both must be listed and told apart. A plan row in
    Postgres holds only the configuration of its LAST run, so the plan rows can
    only ever answer one entry per plan.

    Every part of a configuration is already on the runs: the target type and
    reference id and the two models sit in the reserved `langwatch` namespace of
    the run metadata, the resolved parameters sit beside it, and the repeat
    count is the number of runs of one batch that share a scenario and a target.
    So the list is a GROUP BY over the runs, with the scope and the plan name
    read from the plan row the set id names.

    The run NOTE is never part of a configuration. It sits in the same metadata
    blob, so it is easy to include by accident and must not be.

  @integration
  Scenario: One plan run with two parameter sets is two configurations
    Given a run plan run once with the parameter "region" set to "eu-central"
    And the same plan run again with the parameter "region" set to "us-east"
    When the configurations of that scope are read
    Then two configurations are listed
    And they carry the same plan name
    And their keys are different

  @integration
  Scenario: The same configuration run many times is one entry
    Given a run plan run three times with the same targets, parameters and repeat count
    When the configurations of that scope are read
    Then one configuration is listed
    And it reads the time of the newest of the three runs

  @integration
  Scenario: The repeat count is counted from the runs of the batch
    Given a run plan run with a repeat count of 3
    When the configurations of that scope are read
    Then the configuration reads a repeat count of 3

  @integration
  Scenario: Configurations are listed newest first
    Given a scope with an older configuration and a newer one
    When the configurations of that scope are read
    Then the newer configuration is listed first

  @integration
  Scenario: The note is never part of a configuration
    Given two runs of one plan that share every setting and carry different notes
    When the configurations of that scope are read
    Then one configuration is listed
    And no note is carried on it

  @integration
  Scenario: A scope that never ran lists nothing
    Given a run plan that never ran
    When the configurations of that scope are read
    Then no configuration is listed

  @integration
  Scenario: A run recorded before the models were stamped keys as naming no model
    Given a run whose metadata names neither simulation model
    When the configurations of that scope are read
    Then the configuration names no simulator model
    And it names no judge model

  @integration
  Scenario: The read carries the models the plan was configured with
    Given a run plan run with the simulator model "openai/gpt-5-mini" and the judge model "openai/gpt-5"
    When the configurations of that scope are read
    Then the configuration names both models

  @unit
  Scenario: A configuration read off the runs keys the same as the plan row it came from
    Given a run plan whose stored row holds the targets, repeat count, models and parameters of its last run
    When the entry read off the runs and the entry read off the plan row are keyed
    Then the two keys are the same

    This is the contract the whole feature stands on. The dialog rebuilds the
    key of what it currently holds to mark the matching entry, so a read that
    keys differently marks nothing and silently offers duplicates.

  @integration
  Scenario: Two scenarios of one batch that resolved different parameters take the first scenario's
    Given a batch whose first scenario resolved "region" as "eu-central"
    And whose second scenario resolved "region" as "us-east"
    When the configurations of that scope are read
    Then the configuration carries "region" as "eu-central"

    A person who sets a parameter in the dialog sets it for every scenario, so
    the first scenario's value IS what they chose. Values only diverge for
    defaults nobody set, and a union of them would move the key whenever a
    scenario with a different default joined the scope.

  @unit
  Scenario: A target keeps the bindings its plan row holds
    Given a plan whose prompt target carries scenario mappings
    When the configurations of that scope are read
    Then the target of the configuration carries those mappings

    The run records only the target type and reference id. The mappings are not
    part of the configuration key, so taking them from the plan row cannot
    change which configurations are listed, and without them a picked entry
    would refill the dialog with a prompt target that lost its bindings.
