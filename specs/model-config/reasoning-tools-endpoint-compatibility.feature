Feature: Reasoning and function tools on the same endpoint
  As a user running a scenario, an evaluator or a playground call
  I want a model that rejects reasoning alongside function tools to be
  corrected before the request leaves us
  So that the call returns an answer instead of a provider 400

  # Some models reject reasoning combined with function tools, and they
  # reject it per endpoint rather than outright. The gpt-5.6 family
  # answers a tool-carrying /v1/chat/completions request with:
  #
  #   Function tools with reasoning_effort are not supported for
  #   gpt-5.6-sol in /v1/chat/completions. To use function tools, use
  #   /v1/responses or set reasoning_effort to 'none'.
  #
  # We never send reasoning_effort for the scenario judge, so the model
  # applies its own server-side default, sees the judge's forced
  # continue_test / finish_test tools, and 400s. The judge always sends
  # tools, so on those models it can never return a verdict at all.
  #
  # The rule is declared in the model registry
  # (platform/app/src/server/modelProviders/llmModels.json,
  # reasoningConfig.toolsIncompatibleOn) and enforced at the nlpgo
  # dispatch chokepoint (services/nlpgo/adapters/litellm/reasoningcaps.go),
  # which every chat-completions request passes through. A blanket "strip
  # reasoning whenever tools are present" rule is deliberately NOT what we
  # do: it would silently downgrade every reasoning model that handles
  # tools perfectly well, which is nearly all of them.

  Background:
    Given the model registry declares reasoning capability per model
    And each capability records whether reasoning can be disabled
    And each capability records the endpoints where reasoning and tools conflict

  # ==========================================================================
  # The dispatch-time rule (services/nlpgo/adapters/litellm)
  # ==========================================================================

  @unit
  Scenario: a conflicting model sending tools has its reasoning turned off
    Given a chat-completions request for "gpt-5.6-sol"
    And the request carries function tools
    And the model declares reasoning and tools conflict on chat completions
    And the model can disable reasoning
    When the request is prepared for dispatch
    Then reasoning effort is set to "none"
    And the function tools are left on the request
    And no error is raised to the caller

  @unit
  Scenario: a reasoning model with no declared conflict keeps its reasoning
    Given a chat-completions request for "gpt-5.1"
    And the request carries function tools
    And the model declares no conflict between reasoning and tools
    When the request is prepared for dispatch
    Then the reasoning effort on the request is unchanged
    And the function tools are left on the request

  @unit
  Scenario: a conflicting model with no tools keeps its reasoning
    Given a chat-completions request for "gpt-5.6-sol"
    And the request carries no function tools
    When the request is prepared for dispatch
    Then the reasoning effort on the request is unchanged
    # The conflict is between reasoning AND tools. A plain completion on
    # the same model is free to reason as hard as it likes.

  @unit
  Scenario: the conflict is scoped to the endpoint it was declared on
    Given a responses-endpoint request for "gpt-5.6-sol"
    And the request carries function tools
    And the model declares the conflict on chat completions only
    When the request is prepared for dispatch
    Then the reasoning effort on the request is unchanged
    # This is the provider's own remedy: /v1/responses accepts the pair.

  @unit
  Scenario: a model that cannot disable reasoning is passed through untouched
    Given a chat-completions request for a model that declares the conflict
    And that model cannot disable reasoning
    And the request carries function tools
    When the request is prepared for dispatch
    Then the request body is left exactly as the caller wrote it
    And the conflict is reported to the caller for logging
    # No rewrite satisfies both constraints. Dropping the tools would
    # produce a confident answer with no tool call behind it, which is
    # the bug this feature exists to kill, so the provider's own 400
    # stands and we log it as a known, named condition. Routing to
    # /v1/responses is the standing follow-up.

  @unit
  Scenario: the alias spellings of reasoning effort collapse before the override
    Given a chat-completions request for "gpt-5.6-sol"
    And the request carries function tools
    And the request sets reasoning under the alias "reasoning"
    When the request is prepared for dispatch
    Then only "reasoning_effort" remains on the request
    And its value is "none"
    # Four spellings of this parameter are in the wild (reasoning,
    # reasoning_effort, thinkingLevel, effort). Setting one while leaving
    # another behind sends the provider a contradiction.

  # ==========================================================================
  # Registry self-consistency
  # ==========================================================================

  @unit
  Scenario: every declared reasoning capability is internally consistent
    Given the model registry
    When the reasoning capabilities are checked
    Then every default reasoning value is one of that model's allowed values
    And a capability can disable reasoning exactly when "none" is allowed
    And a declared endpoint conflict names a model that also supports tools

  @unit
  Scenario: a reasoning-class model claiming tools with no capability is caught
    Given a reasoning-class model that lists both reasoning and tools
    And that model has no reasoning capability declared
    When the registry is checked for undeclared reasoning models
    Then that model is reported
    # The registry is regenerated from an upstream catalog that has no
    # notion of the constraint, so a new sibling of gpt-5.6 arrives
    # claiming the combination works. The check names it rather than
    # waiting for production to.

  @unit
  Scenario: the gpt-5.6 family is no longer undeclared
    Given the model registry
    When the registry is checked for undeclared reasoning models
    Then no "gpt-5.6" model is reported

  # ==========================================================================
  # Generated capability table
  # ==========================================================================

  @unit
  Scenario: adding a conflicting model needs registry data and nothing else
    Given a new model entry whose reasoning capability declares an endpoint conflict
    When the dispatch capability table is generated from the registry
    Then the new model appears in the table with its endpoints and disable flag
    And no hand-written dispatch code changes
