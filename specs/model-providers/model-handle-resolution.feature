Feature: Resolving a runnable model handle for a project
  As a developer calling an AI feature from anywhere in the platform
  I want getVercelAIModel to hand back a handle backed by a provider that is actually configured and enabled
  So that a feature either runs against a real provider or fails with a message that names the fix

  # Scope: the server-side ladder in
  # `platform/app/src/server/modelProviders/utils.ts` that turns
  # (projectId, featureKey, optional explicit model) into a Vercel AI SDK
  # handle. Siblings own the neighbouring concerns:
  #
  #   - specs/model-providers/model-resolver-and-registry.feature
  #       the resolveModelForFeature contract + ModelNotConfiguredError shape.
  #   - specs/model-providers/model-default-config-cascade.feature
  #       the storage shape and the org → team → project walk.
  #   - specs/model-providers/role-based-default-models.feature
  #       the settings UI that writes those defaults.
  #
  # This file is only about what the handle-builder does with whatever the
  # cascade returns, and about the guards that sit in front of it.
  #
  # There is deliberately NO global DEFAULT_MODEL constant behind this
  # ladder. A project whose providers cannot serve any model gets an error
  # naming the remedy, never a silent substitution to someone else's
  # provider — substituting would bill an unrelated key and leak the prompt
  # to a vendor the user did not choose.

  Background:
    Given a project exists
    And a model handle is requested for that project

  # ────────────────────────────────────────────────────────────────────────────
  # Guards on an explicitly requested model
  # ────────────────────────────────────────────────────────────────────────────

  @unit
  Scenario: An explicit model whose provider is not configured is refused
    Given the caller asks for "azure/my-gpt4-deployment" explicitly
    And no "azure" provider is configured for the project
    Then the call fails saying provider "azure" is not configured for this project
    And the message points at Settings → Model Providers to add it

  @unit
  Scenario: An explicit model whose provider is disabled is refused
    Given the caller asks for "azure/my-gpt4-deployment" explicitly
    And the "azure" provider is configured but disabled
    Then the call fails saying provider "azure" is configured but disabled
    And the message points at Settings → Model Providers to enable it

  # ────────────────────────────────────────────────────────────────────────────
  # Falling back when no default resolves
  # ────────────────────────────────────────────────────────────────────────────

  @unit
  Scenario: An enabled provider with a usable custom model rescues an unresolvable default
    Given no default model resolves for the requested feature
    And the "azure" provider is enabled with custom model "my-gpt4-deployment"
    When no explicit model is given
    Then a handle is returned for that custom deployment

  @unit
  Scenario: A stale legacy project default does not steer the resolved handle
    Given the project row still carries a legacy default model "openai/gpt-4"
    And no "openai" provider is configured
    And the "azure" provider is enabled with custom model "my-gpt4-deployment"
    When no explicit model is given
    Then a handle is returned from the enabled azure provider
    # The legacy `project.defaultModel` column is no longer read by the
    # handle-builder at all; defaults come from the cascade. This scenario
    # pins that a leftover value pointing at an unconfigured provider
    # cannot resurrect it.

  @integration @unimplemented
  Scenario: A configured-nothing cascade surfaces the missing-model popup instead of being rescued
    Given the cascade has no default configured at any scope for the feature
    And some provider is enabled with a usable custom model
    When no explicit model is given
    Then the call fails with the missing-model error carrying the feature and role
    And the enabled provider is NOT silently substituted
    # ModelNotConfiguredError is rethrown ahead of the rescue ladder so the
    # frontend interceptor can open the missing-model popup with the
    # feature in context. Only resolver-internal failures (DB, race) fall
    # through to the "any enabled provider" rescue.

  # ────────────────────────────────────────────────────────────────────────────
  # Nothing can serve the request
  # ────────────────────────────────────────────────────────────────────────────

  @unit
  Scenario: An enabled provider with no usable model is not rescued by a global default
    Given the "openai" provider is enabled but has no custom models
    And no default model resolves for the requested feature
    When no explicit model is given
    Then the call fails saying all configured providers are disabled or have no usable models
    And no global fallback model is substituted
    # This is the canonical "AI features are switched off for this
    # project" surface. It used to fall back to a hardcoded constant,
    # which quietly sent traffic to a provider the project never enabled.

  @unit
  Scenario: A project whose providers are all disabled is told they are disabled
    Given the "azure" provider has a custom model but is disabled
    When no explicit model is given
    Then the call fails saying all configured providers are disabled or have no usable models
    And the message points at Settings → Model Providers to enable one or add a model

  @unit
  Scenario: A project with no providers at all is told to add one
    Given the project has no model providers configured
    When no explicit model is given
    Then the call fails saying no model providers are configured for this project
    And the message points at Settings → Model Providers to add one
