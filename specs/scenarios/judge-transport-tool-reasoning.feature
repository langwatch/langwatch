Feature: Scenario judge transport — function tools and reasoning effort
  As someone running a criteria-graded simulation,
  I want the judge to reach a verdict on a reasoning model,
  so that a run reports what the agent actually did instead of an infrastructure error.

  # Background (#6369, langwatch/scenario#864)
  #
  # The judge forces a finish_test / continue_test function-tool call. On
  # /v1/chat/completions some reasoning models reject function tools unless
  # reasoning_effort is explicitly "none":
  #
  #   Function tools with reasoning_effort are not supported for <model> in
  #   /v1/chat/completions. To use function tools, use /v1/responses or set
  #   reasoning_effort to 'none'.
  #
  # Nothing on the platform path sets reasoning_effort, so every criteria-graded
  # run on such a model died before a verdict. The rule belongs to the transport,
  # not to the judge: any chat-completions caller that sends function tools to
  # such a model hits it.
  #
  # Reasoning is disabled by RETRY, never preemptively. Whether a model accepts
  # reasoning off is not knowable up front — Gemini 2.5 Pro rejects it with
  # "Budget 0 is invalid. This model only works in thinking mode." — so the
  # request goes out untouched, and is re-sent with reasoning off only when the
  # provider's rejection asks for exactly that. Models that work today are never
  # sent anything new.

  Background:
    Given a scenario run dispatched to a worker

  @integration
  Scenario: A rejected tool-carrying request is retried with reasoning off
    Given an endpoint that rejects function tools unless reasoning_effort is "none"
    When a chat-completions request carrying function tools is sent
    Then the request is retried with reasoning_effort "none"
    And the retried request succeeds

  @integration
  Scenario: A model that accepts the request is never sent anything new
    Given an endpoint that accepts tool-carrying requests as they are
    When a chat-completions request carrying function tools is sent
    Then exactly one request reaches the endpoint
    And the request body has no reasoning_effort

  @integration
  Scenario: A model whose reasoning cannot be disabled is never asked to disable it
    Given an endpoint that requires reasoning to stay on
    When a chat-completions request carrying function tools is sent and accepted
    Then the request body has no reasoning_effort

  @integration
  Scenario: An unrelated rejection is surfaced, not retried
    Given an endpoint that rejects the request for a reason other than reasoning
    When a chat-completions request carrying function tools is sent
    Then the rejection is surfaced to the caller
    And no retry is attempted

  @integration
  Scenario: An explicitly requested reasoning effort is preserved
    Given the caller has already set reasoning_effort to "high"
    When a chat-completions request carrying function tools is rejected
    Then the rejection is surfaced with reasoning_effort still "high"

  @integration
  Scenario: The judge reaches a verdict against an endpoint that enforces the rule
    Given an endpoint that rejects function tools unless reasoning_effort is "none"
    When the judge grades a conversation against its criteria
    Then the endpoint accepts the retried call
    And the run returns a verdict rather than an infrastructure error
