Feature: A run records the models it really ran on
  As a person reading a run from last month
  I want the run to name the simulator and the judge it used
  So that I can tell what decided its verdicts, whatever the project default is today

  Background: what a run records, and why it records two things.
    A run plan can name the model that plays the person and the model that
    decides the verdict. When it names neither, the case's own choice answers,
    and when the case names none either, the project default for that role
    does.

    The plan's choice is what keys a configuration in the run dialog, so it
    stays recorded exactly as the person chose it: empty when they chose
    nothing. See specs/scenarios/run-configuration-on-runs.feature.

    The RESOLVED model is what the run ran on, and it is recorded beside the
    configured one. A project default changes over time, so a run that recorded
    only "the plan named no model" cannot say which model judged it.

    Both travel in the reserved "langwatch" namespace of the run metadata, the
    same way the case version and the person who started the run travel, so
    they need no column of their own.

    The chain that picks the models has one definition. The queue path uses it
    to stamp the run, and the execution prefetch uses it to build the models,
    so the run cannot say one model and run another.

  # ============================================================================
  # The chain
  # ============================================================================

  @unit
  Scenario: A run plan that names a model resolves that model
    Given a run plan whose simulator model is "openai/gpt-5-mini"
    And a case that names its own simulator model
    When the models of the run are resolved
    Then the simulator model is "openai/gpt-5-mini"
    And the project default is never read for the simulator

  @unit
  Scenario: A case answers when its run plan names no model
    Given a run plan that names no judge model
    And a case whose judge model is "anthropic/claude-sonnet-4"
    When the models of the run are resolved
    Then the judge model is "anthropic/claude-sonnet-4"
    And the project default is never read for the judge

  @unit
  Scenario: The project default answers when neither the plan nor the case names a model
    Given a run plan and a case that name no model at all
    When the models of the run are resolved
    Then the simulator model is the project default for "scenarios.user_simulator"
    And the judge model is the project default for "scenarios.judge"

  # ============================================================================
  # What the run records
  # ============================================================================

  @unit
  Scenario: A queued run records the models it resolved
    Given a run plan that names no model
    And a project whose default judge model is "openai/gpt-5"
    When the plan is run
    Then every run of that batch records the resolved judge model "openai/gpt-5"
    And every run of that batch records the resolved simulator model of the project

  @unit
  Scenario: The resolved models sit beside the configured ones, not in place of them
    Given a run plan whose judge model is "openai/gpt-5"
    When the plan is run
    Then the runs record the judge model "openai/gpt-5"
    And the runs record the resolved judge model "openai/gpt-5"

  @unit
  Scenario: A project with no model set for a role records no resolved model
    Given a project with no default model for the judge
    When the plan is run
    Then the runs record no resolved judge model
    And the runs are still queued
    # The prefetch refuses such a run with its own remediation message. Losing
    # the run at the queue over a record kept for the reader would be worse.

  @unit
  Scenario: A run of a single case records the models the validation prefetch resolved
    Given a single case is run against a target
    When the run is queued
    Then it records the resolved simulator model and the resolved judge model

  # ============================================================================
  # Reading it back
  # ============================================================================

  @integration
  Scenario: The run settings read the resolved model, not the configured one
    Given a run that recorded a resolved judge model
    When the run settings are read
    Then the judge model of the settings is the resolved one

  @unit
  Scenario: A run that recorded both models reads the resolved one
    Given a run that records a configured judge model and a resolved one
    When the run settings are read
    Then the judge model of the settings is the resolved one
    And the configured one is not read in its place

  @unit
  Scenario: A run stored before the resolved models existed reads its configured model
    Given a run that records a configured judge model and no resolved one
    When the run settings are read
    Then the judge model of the settings is the configured one

  @unit
  Scenario: A run that records neither model reads as none
    Given a run that records no judge model of either kind
    When the run settings are read
    Then the judge model of the settings is none
