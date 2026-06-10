Feature: Missing-model toast when a feature can't resolve a model
  As a user using a LangWatch feature that needs an LLM (AI search, autocomplete, scenario generation, etc.)
  I want a clear, one-click path to fix the configuration when no model is set for that feature
  So that I never see a raw error and always know exactly what to do next

  # Server throws a typed `ModelNotConfiguredError` carrying the feature
  # key, role, and project context. The tRPC error formatter surfaces it
  # with a stable `cause.code = "MODEL_NOT_CONFIGURED"` so the frontend
  # interceptor in `utils/api.tsx` can catch it and emit a sticky
  # orange toast via `showMissingModelToast`. The class and resolver
  # live with B3.1; this spec describes the frontend interceptor +
  # toast UX (B3.2).
  #
  # A second discriminator `AI_CALL_FAILED` covers the case where the
  # cascade DID resolve a model but the downstream call failed
  # (provider 401, 5xx, malformed custom model id). It funnels through
  # `showAiCallFailedToast` so the user gets a "double-check your
  # model configuration" hint instead of a raw 500.

  Background:
    Given I am logged in
    And I have access to a project in an organization

  # ============================================================================
  # Catching the typed error
  # ============================================================================

  @integration
  Scenario: A tRPC call that throws ModelNotConfigured opens the toast
    Given the organization has no Fast model set anywhere in the scope chain
    When I trigger "traces.ai_search" from the Trace Explorer
    Then a global handler catches the typed error
    And a "Model not configured" toast appears
    And the original tRPC error does not surface as a generic red error toast

  @integration @unimplemented
  Scenario: A Hono REST endpoint surfaces the same typed error to the toast
    Given an external integration calls the AI-search REST endpoint with no Fast model configured
    When the endpoint returns 422 with code "MODEL_NOT_CONFIGURED"
    And the same call is made from the LangWatch UI
    Then the UI handler maps the response into the same toast
    # Gated on B3.1's Hono error middleware verifying the cause string is
    # serialized through to the response body. Promoted once the matching
    # binding test lands.

  # ============================================================================
  # Toast content
  # ============================================================================

  @integration
  Scenario: The toast names the feature, the role, and the scope it couldn't resolve from
    Given "traces.ai_search" is registered under the Fast role
    When the toast opens for that feature
    Then the title reads "Model not configured for AI search"
    And the body explains that the Fast role needs a model picked in Model Providers settings
    And the toast is sticky (no auto-dismiss) so a user who steps away still sees it

  @integration
  Scenario: The modal carries one primary CTA to the right settings page and role
    When the toast opens for a Fast-role feature
    Then the action button reads "Configure Fast model"
    And clicking the action navigates to the model-providers settings page with the Fast role anchor

  # ============================================================================
  # Permission-aware variant
  # ============================================================================

  @integration
  Scenario: A read-only user sees the modal but no Configure button
    Given I am a Lite Member without "organization:manage" or "project:update"
    When a feature throws ModelNotConfigured for me
    Then the toast opens with the explanation
    And no Configure action button is shown
    And the body advises me to ask an admin to configure the missing model

  # ============================================================================
  # Telemetry / debounce
  # ============================================================================

  @integration
  Scenario: Identical errors in quick succession only open one modal
    Given AI Search retries five times in two seconds
    And every attempt throws ModelNotConfigured for the same (featureKey, role, scopeChain)
    When the errors arrive at the interceptor
    Then exactly one toast appears for that error signature
    And the toast does not re-mount on each subsequent error
    # Toast id is stable per (featureKey, role); `toaster.isVisible(id)`
    # short-circuits duplicate emits.

  # ============================================================================
  # Downstream AI-call failures (not MODEL_NOT_CONFIGURED)
  # ============================================================================

  @integration
  Scenario: Downstream AI failures surface a hint to verify model configuration
    Given the Fast role resolves to a model whose provider key is invalid
    When the workflow auto-commit fires and the provider returns 401
    Then the global interceptor catches the AiCallFailedError
    And a toast appears titled "Workflow commit message failed"
    And the body says "Double-check your Fast model configuration in Model Providers"
    And the original short provider error message is surfaced underneath the hint

  # ============================================================================
  # Background-task / no-UI-context surface (future)
  # ============================================================================

  @integration @unimplemented
  Scenario: A background job that throws ModelNotConfigured surfaces as a banner or notification, not a modal
    Given the topic-clustering background job runs without a UI tab open
    When the job throws ModelNotConfigured for "analytics.topic_clustering_llm"
    Then the next time the user lands anywhere in LangWatch they see a notification
    And the notification carries the same "Configure {role} model" CTA the toast would
    And the failure is recorded so the user can see which jobs were skipped while the model was missing

  # ============================================================================
  # Provider-disabled variant (cascade DID resolve, but the chosen
  # provider is currently disabled)
  # ============================================================================
  #
  # Distinct from MODEL_NOT_CONFIGURED: the cascade picked a model, but
  # the backing provider has been toggled off. This is the common case
  # the user hit with the project-scope `traces.ai_search` set to a
  # broken openai default while their org-level Azure default was the
  # one they intended to use. The toast offers a one-click swap to
  # the cascade-next candidate (when one exists with an enabled
  # provider) by clearing the disabled scope's feature key — the
  # next resolve then falls through to the alternate.

  Rule: Provider-disabled toast
    A typed `ModelProviderDisabledError` (cause code MODEL_PROVIDER_DISABLED)
    surfaces a swap-to-parent toast distinct from the missing-model one.

    @integration
    Scenario: Project-scope override with disabled provider and an org alternate
      Given the project sets "traces.ai_search" to "openai/gpt-4o"
      And the project's openai provider is disabled
      And the organization sets "traces.ai_search" to "azure/gpt-4o" with azure enabled
      When the user triggers an AI search
      Then a "Model unavailable for AI search" toast appears
      And the toast names the disabled project default
      And the toast's primary action reads "Use organization default (azure/gpt-4o)"
      And clicking the action clears the project-scope key via setFeatureOverrideForScope(model: null)
      And the next AI search resolves to azure/gpt-4o

    @integration
    Scenario: No alternate falls back to settings deep-link
      Given the only configured default for "traces.ai_search" is at project scope
      And the project's provider for that model is disabled
      When the AI search fails
      Then the toast's primary action reads "Open settings"
      And clicking it navigates to /settings/model-providers

    @integration
    Scenario: Disabled scope above project is not user-clearable from the toast
      Given the team default for "traces.ai_search" resolves to a disabled provider
      And the cascade has an organization alternate with an enabled provider
      When the AI search fails for a project-level user without team:manage
      Then the toast still names the team-scope disabled default
      But the primary action falls back to "Open settings" (no inline swap)

    @integration
    Scenario: Repeated failures within the same scope coalesce into one toast
      Given AI Search retries five times in two seconds
      And every attempt throws MODEL_PROVIDER_DISABLED for the same scope/feature
      Then exactly one toast renders for that error signature
