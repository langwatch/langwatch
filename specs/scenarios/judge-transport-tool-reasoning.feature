Feature: Scenario judge verdicts on reasoning models
  As someone running a criteria-graded simulation,
  I want the judge to reach a verdict on a reasoning model,
  so that a run reports what the agent actually did instead of an infrastructure error.

  # Background (#6369, langwatch/scenario#864)
  #
  # Some models refuse to return the structured verdict the judge asks for while
  # their own reasoning is on, and name the setting they would accept instead.
  # Others refuse to work with their reasoning off at all. Which of the two a
  # model is cannot be known before it is asked, so a request goes out as the run
  # configured it and changes only in answer to what the provider actually said.
  # A model already known to need its reasoning off is configured that way up
  # front — see specs/scenarios/judge-reasoning-tool-compatibility.feature.
  #
  # The rule belongs to the transport rather than to the judge: anything that
  # asks such a model for a structured answer meets it.

  Background:
    Given a scenario run dispatched to a worker

  @integration
  Scenario: A refusal that names reasoning is answered by asking again without it
    Given a model that refuses a verdict while its reasoning is on, and says so
    When the judge grades a conversation against its criteria
    Then the judge asks again with the model's reasoning switched off
    And the second attempt is accepted

  @integration
  Scenario: A criteria-graded run reports the verdict its criteria produced
    Given a model that refuses a verdict while its reasoning is on, and says so
    When the judge grades a conversation against its criteria
    Then the run reports that verdict rather than an infrastructure error

  @integration
  Scenario: A model that accepts the first attempt is never asked anything new
    Given a model that returns a verdict as the judge is configured
    When the judge grades a conversation against its criteria
    Then the model is asked exactly once
    And the judge leaves the model's reasoning as configured

  @integration
  Scenario: A model whose reasoning cannot be disabled is never asked to disable it
    Given a model that only works with its reasoning on
    When the judge grades a conversation against its criteria
    Then the judge leaves the model's reasoning as configured

  @integration
  Scenario: A reasoning refusal that names no remedy is surfaced, not retried
    Given a model that refuses the reasoning it was given without naming one it accepts
    When the judge grades a conversation against its criteria
    Then the refusal is reported as it stands
    And the judge does not ask again

  @integration
  Scenario: An unrelated rejection is surfaced, not retried
    Given a model that refuses the request for a reason unrelated to reasoning
    When the judge grades a conversation against its criteria
    Then the refusal is reported as it stands
    And the judge does not ask again

  @integration
  Scenario: A run that pins the judge's reasoning keeps it
    Given a run that has pinned how hard the judge should think
    And a model that refuses a verdict while its reasoning is on
    When the judge grades a conversation against its criteria
    Then the refusal is reported as it stands
    And the pinned setting is left as the run asked for it
