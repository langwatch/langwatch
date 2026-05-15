Feature: Missing-model popup when a feature can't resolve a model
  As a user using a LangWatch feature that needs an LLM (AI search, autocomplete, scenario generation, etc.)
  I want a clear, one-click path to fix the configuration when no model is set for that feature
  So that I never see a raw error and always know exactly what to do next

  # Server throws a typed `ModelNotConfiguredError` (carrying the feature
  # key, role, and scope context). The tRPC + Hono error middlewares
  # surface it on the wire with a stable code so the frontend can catch
  # it and render the popup, similar to how UpgradeRequiredError feeds
  # the upgrade modal today. The class and resolver live with B3.1; this
  # spec describes the frontend interceptor + modal UX (B3.2).

  Background:
    Given I am logged in
    And I have access to a project in an organization

  # ============================================================================
  # Catching the typed error
  # ============================================================================

  @integration
  Scenario: A tRPC call that throws ModelNotConfigured opens the popup
    Given the organization has no Fast model set anywhere in the scope chain
    When I trigger "traces.ai_search" from the Trace Explorer
    Then a global handler catches the typed error
    And a "Model not configured" modal opens
    And the original tRPC error does not surface as a generic toast

  @integration @unimplemented
  Scenario: A Hono REST endpoint surfaces the same typed error to the modal
    Given an external integration calls the AI-search REST endpoint with no Fast model configured
    When the endpoint returns 422 with code "MODEL_NOT_CONFIGURED"
    And the same call is made from the LangWatch UI
    Then the UI handler maps the response into the same modal
    # Gated on B3.1's Hono error middleware verifying the cause string is
    # serialized through to the response body. Promoted once the matching
    # binding test lands.

  # ============================================================================
  # Modal content
  # ============================================================================

  @integration
  Scenario: The modal names the feature, the role, and the scope it couldn't resolve from
    Given "traces.ai_search" is registered under the Fast role
    When the modal opens for that feature
    Then the title reads "Model not configured for AI Search"
    And the body explains that the Fast role has no model set for this project, its team, or its organization
    And the body lists the three scopes in order so the user knows where the gap is

  @integration
  Scenario: The modal carries one primary CTA to the right settings page and role
    When the modal opens for a Fast-role feature
    Then the primary button reads "Configure Fast model"
    And clicking the button navigates to the model-providers settings page with the Fast role line scrolled into view and focused
    And the focused state is preserved after navigation (no extra clicks to find the row)

  @integration
  Scenario: An inline "Customize for this feature" link routes to the per-feature override
    Given the user wants a different model for AI Search only, not the whole Fast role
    When the modal is open
    Then the body carries an inline link "Customize for AI Search instead"
    And clicking that link navigates to the settings page with the Fast role expanded AND the AI Search row scrolled into view

  # ============================================================================
  # Permission-aware variant
  # ============================================================================

  @integration
  Scenario: A read-only user sees the modal but no Configure button
    Given I am a Lite Member without "organization:manage" or "project:update"
    When a feature throws ModelNotConfigured for me
    Then the modal opens with the explanation
    And no primary CTA is shown
    And the body advises me to ask an admin to configure the missing model

  # ============================================================================
  # Telemetry / debounce
  # ============================================================================

  @integration
  Scenario: Identical errors in quick succession only open one modal
    Given AI Search retries five times in two seconds
    And every attempt throws ModelNotConfigured for the same (featureKey, role, scopeChain)
    When the errors arrive at the interceptor
    Then exactly one modal opens for that error signature
    And the modal does not re-mount on each subsequent error

  @integration
  Scenario: A different feature still opens its own modal even within the debounce window
    Given AI Search has just opened a ModelNotConfigured modal and the user has not dismissed it
    When a different feature throws ModelNotConfigured for a different (featureKey, role) within the same second
    Then a second modal opens for the new feature
    And the AI Search modal stays mounted underneath or is replaced, never silently dropped

  # ============================================================================
  # Background-task / no-UI-context surface (future)
  # ============================================================================

  @integration @unimplemented
  Scenario: A background job that throws ModelNotConfigured surfaces as a banner or notification, not a modal
    Given the topic-clustering background job runs without a UI tab open
    When the job throws ModelNotConfigured for "analytics.topic_clustering_llm"
    Then the next time the user lands anywhere in LangWatch they see a notification
    And the notification carries the same "Configure {role} model" CTA the modal would
    And the failure is recorded so the user can see which jobs were skipped while the model was missing
