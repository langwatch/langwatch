Feature: Scenario judge transport — function tools and reasoning effort
  As someone running a criteria-graded simulation,
  I want the judge to reach a verdict on a reasoning model,
  so that a run reports what the agent actually did instead of an infrastructure error.

  # Background (#6369, langwatch/scenario#864)
  #
  # The judge forces a finish_test / continue_test function-tool call. On
  # /v1/chat/completions a reasoning model rejects function tools unless
  # reasoning_effort is explicitly "none":
  #
  #   Function tools with reasoning_effort are not supported for <model> in
  #   /v1/chat/completions. To use function tools, use /v1/responses or set
  #   reasoning_effort to 'none'.
  #
  # Nothing on the platform path sets reasoning_effort, so every criteria-graded
  # run on such a model died before a verdict. The rule belongs to the transport,
  # not to the judge: any chat-completions caller that sends function tools to a
  # reasoning model hits it.
  #
  # Whether a model accepts reasoning_effort is resolved in the parent process,
  # which owns the model registry and the project's custom-model overrides; the
  # child worker has neither and is told the answer.

  Background:
    Given a scenario run dispatched to a worker

  @integration
  Scenario: A tool-carrying request to a reasoning model declares reasoning off
    Given a model built for a target that accepts reasoning_effort
    When a chat-completions request carrying function tools is sent
    Then the request body carries reasoning_effort "none"

  @integration
  Scenario: A request without tools is left alone
    Given a model built for a target that accepts reasoning_effort
    When a chat-completions request carrying no tools is sent
    Then the request body has no reasoning_effort

  @integration
  Scenario: A model that does not accept reasoning_effort is left alone
    Given a model built for a target that does not accept reasoning_effort
    When a chat-completions request carrying function tools is sent
    Then the request body has no reasoning_effort

  @integration
  Scenario: An explicitly requested reasoning effort is preserved
    Given a model built for a target that accepts reasoning_effort
    And the caller has already set reasoning_effort to "high"
    When a chat-completions request carrying function tools is sent
    Then the request body still carries reasoning_effort "high"

  @integration
  Scenario: The judge reaches a verdict against an endpoint that enforces the rule
    Given an endpoint that rejects function tools unless reasoning_effort is "none"
    And a judge model built for a target that accepts reasoning_effort
    When the judge grades a conversation against its criteria
    Then the endpoint accepts the call
    And the run returns a verdict rather than an infrastructure error

  @unit
  Scenario: The judge's reasoning support travels from the parent to the worker
    Given a project whose judge model accepts reasoning_effort
    When the run is prefetched
    Then the child process job data records that the judge model accepts reasoning_effort
