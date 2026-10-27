Feature: A run records the configuration it ran under
  As a person opening the run dialog
  I want the previous configurations of this scope offered back to me
  So that I can repeat a run without rebuilding it field by field

  Background: why a run, and not only the plan, has to carry this.
    The Run name dropdown lists the previous configurations of a scope. A
    configuration is the scope, the targets, the repeat count, the two
    simulation models and the run parameters. The run NOTE is never part of
    one.

    Configuration identity is WIDER than plan identity: one plan run twice
    with different parameters, or a different repeat count, is two
    configurations and both are listed. So the list cannot be built from the
    plan rows alone, because a plan row holds only the config of its last
    run. It has to be read back from the runs.

    Most of a configuration is already on each queued run: the target, and the
    resolved run parameters. The repeat count is derived, by counting the runs
    of one batch that share a scenario and a target. The two simulation models
    were the missing piece, and they are stamped here.

    The value stamped is the one the plan was CONFIGURED with, which is empty
    when the plan names no model and the project default is used. It is not
    the model the run resolved to, because a configuration is what a person
    chose, and the same choice must key the same way after a project default
    changes.

  @integration
  Scenario: A run records the simulation models its plan was configured with
    Given a run plan whose simulator model is "openai/gpt-5-mini" and whose judge model is "openai/gpt-5"
    When the plan is run
    Then every run of that batch records the simulator model "openai/gpt-5-mini"
    And every run of that batch records the judge model "openai/gpt-5"

  @integration
  Scenario: A run plan that names no model records no model
    Given a run plan that names neither a simulator model nor a judge model
    When the plan is run
    Then the runs record no simulator model
    And the runs record no judge model

  @integration
  Scenario: A plan that names only one of the two models records only that one
    Given a run plan whose judge model is "openai/gpt-5" and which names no simulator model
    When the plan is run
    Then the runs record the judge model "openai/gpt-5"
    And the runs record no simulator model

  @unit
  Scenario: A configuration naming no model keys the same whether the model is empty or absent
    Given a configuration whose simulator model and judge model are empty
    And a second configuration that names neither field at all
    When both are keyed
    Then the two keys are the same

    This is what lets a run recorded before the models were stamped sit in one
    list beside a run that named no model. Both mean the project default.
