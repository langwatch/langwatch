Feature: Provider setup links from "provider not set up" warnings in Scenario surfaces
  As a LangWatch user who has not configured a model provider
  I want a prominent action button that takes me to the model provider settings page
  So that I can configure a provider without losing my in-progress scenario form or run context

  Background:
    Given I am logged into project "my-project"

  # ============================================================================
  # Surface 1: AICreateModal footer (primary action)
  # ============================================================================

  @integration
  Scenario: AICreateModal footer shows primary Configure model provider button when no providers are enabled
    Given I have no enabled model providers
    When I open the Scenario Create modal
    Then the modal footer shows a primary button with accessible name "Configure model provider"
    And the button links to "/settings/model-providers"
    And the button opens the link in a new tab

  @integration
  Scenario: AICreateModal footer button preserves noopener noreferrer on the new-tab link
    Given I have no enabled model providers
    When I open the Scenario Create modal
    Then the footer "Configure model provider" button uses rel "noopener noreferrer"

  @integration
  Scenario: AICreateModal footer renders no primary action when providers are configured
    Given I have at least one enabled model provider
    When I open the Scenario Create modal
    Then the modal footer does not show a "Configure model provider" button

  # ============================================================================
  # Surface 2: Sidebar "AI Generation" panel — no-providers card
  # ============================================================================

  @integration
  Scenario: Scenario editor sidebar shows Configure model provider button when no providers are enabled
    Given I am on the scenario editor
    And I have no enabled model providers
    Then the sidebar "Model Provider Required" card shows a primary button with accessible name "Configure model provider"
    And the button links to "/settings/model-providers"
    And the button opens the link in a new tab

  @integration
  Scenario: Sidebar "Model Provider Required" card keeps its inline explanatory text alongside the button
    Given I am on the scenario editor
    And I have no enabled model providers
    Then the sidebar card still explains that a model provider must be configured
    And the primary "Configure model provider" button is visible in or replacing the inline link

  # ============================================================================
  # Surface 3: Sidebar default-model banners (no-default / stale-default)
  # ============================================================================

  @integration
  Scenario: Sidebar no-default banner shows Configure default model button
    Given I am on the scenario editor
    And I have at least one enabled model provider
    And no default model is selected for the project
    Then the sidebar banner shows a primary button with accessible name "Configure default model"
    And the button links to "/settings/model-providers"
    And the button opens the link in a new tab

  @integration
  Scenario: Sidebar stale-default banner shows Configure default model button
    Given I am on the scenario editor
    And the project's default model points to a provider that is no longer enabled
    Then the sidebar stale-default banner shows a primary button with accessible name "Configure default model"
    And the button links to "/settings/model-providers"
    And the button opens the link in a new tab

  # ============================================================================
  # Surface 4: useRunScenario toast — uses toaster action slot
  # ============================================================================

  @integration
  Scenario: Run-scenario toast exposes the settings link via the toaster action slot
    Given I am on the scenario editor
    And I have no enabled model providers
    When I trigger a scenario run
    Then a "No model provider configured" toast is shown
    And the toast uses the toaster's action slot (not an inline anchor) for the settings link
    And the toast action has an accessible name equivalent to "Configure model provider"
    And activating the action navigates to "/settings/model-providers"
    And the action opens the link in a new tab

  @integration
  Scenario: Run-scenario toast action pattern matches the existing "View failed run" action idiom
    Given the useRunScenario hook already renders a "View failed run" action on run failure
    When the "No model provider configured" toast is rendered
    Then both toasts use the same toaster action slot idiom
    And neither renders an inline anchor as the primary affordance

  # ============================================================================
  # Cross-cutting: link target and new-tab behavior preserved across all surfaces
  # ============================================================================

  @unit
  Scenario Outline: All four surfaces point at /settings/model-providers and open in a new tab
    Given the <surface> renders its "provider not set up" warning
    Then its primary action links to "/settings/model-providers"
    And the primary action opens in a new tab with rel "noopener noreferrer"

    Examples:
      | surface                                    |
      | AICreateModal footer                       |
      | Scenario editor sidebar no-providers card  |
      | Scenario editor sidebar no-default banner  |
      | Scenario editor sidebar stale-default banner |
      | useRunScenario toast                       |

  @unit
  Scenario: Existing href assertions for inline links continue to pass
    Given tests that assert `href="/settings/model-providers"` on the AICreateModal inline link
    And tests that assert the same href on the sidebar inline link
    When the surfaces are re-rendered after the primary button is added
    Then the existing inline-link href assertions still pass
    And new tests additionally assert the primary button's accessible name and href

  # ============================================================================
  # Explicit out-of-scope guard
  # ============================================================================

  @unit
  Scenario: Orchestrator runtime failure strings are not modified
    Given the runtime orchestrator error messages "provider_not_found", "provider_not_enabled", and "missing_params"
    When this feature is implemented
    Then the strings in orchestrator.ts lines 21-32 are unchanged
    And no structured-error or UI-link plumbing is added for those runtime failures

  # ============================================================================
  # AC Coverage Map
  # ============================================================================
  # AC 1 (AICreateModal footer primary button to /settings/model-providers, target=_blank)
  #   -> "AICreateModal footer shows primary Configure model provider button when no providers are enabled"
  #   -> "AICreateModal footer button preserves noopener noreferrer on the new-tab link"
  #   -> "AICreateModal footer renders no primary action when providers are configured"
  #
  # AC 2 (Sidebar !hasEnabledProviders card includes primary Configure button)
  #   -> "Scenario editor sidebar shows Configure model provider button when no providers are enabled"
  #   -> "Sidebar \"Model Provider Required\" card keeps its inline explanatory text alongside the button"
  #
  # AC 3 (Sidebar no-default / stale-default banner includes primary Configure default model button)
  #   -> "Sidebar no-default banner shows Configure default model button"
  #   -> "Sidebar stale-default banner shows Configure default model button"
  #
  # AC 4 (useRunScenario toast uses toaster action slot, like the "View failed run" pattern)
  #   -> "Run-scenario toast exposes the settings link via the toaster action slot"
  #   -> "Run-scenario toast action pattern matches the existing \"View failed run\" action idiom"
  #
  # AC 5 (Link target /settings/model-providers in all four surfaces; target=_blank rel=noopener noreferrer preserved)
  #   -> "All four surfaces point at /settings/model-providers and open in a new tab" (Scenario Outline covers all four)
  #   -> Each surface's scenario above also asserts "/settings/model-providers" and new-tab behavior
  #
  # AC 6 (Existing href tests still pass; new tests assert button accessible name + href in each surface)
  #   -> "Existing href assertions for inline links continue to pass"
  #   -> Each surface scenario above asserts the new button's accessible name ("Configure model provider" / "Configure default model") and href
  #
  # AC 7 (No changes to orchestrator runtime failure strings; that coverage gap is out of scope)
  #   -> "Orchestrator runtime failure strings are not modified"
