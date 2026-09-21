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
  # The rule belongs to the transport rather than to the judge: every scenario
  # model (judge, simulator, tested prompt agent) rides the same client, so
  # anything that asks such a model for a structured answer meets it. The
  # exchange is bounded at two requests: the configured one, and at most one
  # answer to a refusal that named the value it would accept.

  @integration
  Scenario: A refusal that names reasoning is answered by asking again without it
    Given a model that refuses a tool-carrying request while its reasoning is on, naming the value it would accept
    When the judge grades a conversation against its criteria
    Then the second request declares reasoning off and returns the verdict tool call

  @integration
  Scenario: A criteria-graded run reports the verdict its criteria produced
    Given a judge model that is not on the known-incompatible list
    And its provider refuses a tool-carrying request while reasoning is on, naming the value it would accept
    When the judge grades a conversation against its criteria
    Then the judge's own model client asks again and reports the verdict rather than an infrastructure error

  @integration
  Scenario: A judge model already known to need reasoning off asks only once
    Given a judge model on the known-incompatible list
    When the judge grades a conversation against its criteria
    Then the first and only request already declares reasoning off
    And the verdict tool call is returned

  @integration
  Scenario: A model that accepts the first attempt is never asked anything new
    Given a model that returns a verdict as the judge is configured
    When the judge grades a conversation against its criteria
    Then the model is asked exactly once
    And the request carries no reasoning setting at all

  @integration
  Scenario: A model whose reasoning cannot be disabled is never asked to disable it
    Given a model that only works with its reasoning on
    When the judge grades a conversation against its criteria
    Then the model is asked exactly once
    And the request carries no reasoning setting at all

  @integration
  Scenario: A second refusal ends the exchange
    Given a model that refuses a tool-carrying request even with its reasoning off
    When the judge grades a conversation against its criteria
    Then exactly two requests are sent
    And the caller receives the provider's own second refusal with its param unchanged

  @integration
  Scenario: A request that asks for no tools is never retried
    Given a model that refuses any request while its reasoning is on, naming the value it would accept
    When a request without tools is sent
    Then the model is asked exactly once
    And the caller receives the provider's own 400 with its param unchanged

  @integration
  Scenario: A reasoning refusal that names no remedy is surfaced, not retried
    Given a model that refuses the reasoning it was given, naming the parameter but no value it would accept
    When the judge grades a conversation against its criteria
    Then the model is asked exactly once
    And the caller receives the provider's own 400 with its param unchanged

  @integration
  Scenario: An unrelated rejection is surfaced, not retried
    Given a model that refuses the request for a reason unrelated to reasoning
    When the judge grades a conversation against its criteria
    Then the model is asked exactly once
    And the caller receives the provider's own 400 with its param unchanged

  @integration
  Scenario: A rejection that is not JSON is surfaced untouched
    Given a model that refuses a tool-carrying request with a body that is not JSON
    When the judge grades a conversation against its criteria
    Then the model is asked exactly once
    And the caller receives the provider's own 400 as it stands

  @integration
  Scenario: A run that pins the judge's reasoning keeps it
    Given a run that has pinned how hard the judge should think
    And a model that refuses a verdict while its reasoning is on
    When the judge grades a conversation against its criteria
    Then the model is asked exactly once
    And the request carries the effort the run pinned, unchanged
