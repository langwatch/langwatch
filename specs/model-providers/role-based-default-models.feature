Feature: Role-based default models with per-feature overrides
  As a user setting up LangWatch
  I want to pick a Default model, a Fast model, and an Embeddings model once at the top, and only drill into individual platform features when I want a different model there
  So that one decision flows everywhere, and overriding a specific use is a deliberate next step, not a 20-selector wall

  # Replaces the older "one defaultModel + one topicClusteringModel + one
  # embeddingsModel per scope" mental model. The data, resolver, and
  # ModelNotConfiguredError shape live with B3.1; this file describes the
  # UI in `langwatch/src/components/settings/DefaultModelsSection.tsx`.

  Background:
    Given I am logged in
    And I have access to an organization with at least one team and project
    And I have at least one enabled model provider on the organization

  # ============================================================================
  # Default state: three role lines, nothing else
  # ============================================================================

  @integration
  Scenario: The Default Models section opens with three role lines
    When I open the model providers settings page
    Then below the providers list I see a "Default Models" section
    And the section shows exactly three lines: "Default", "Fast", "Embeddings"
    And each line shows the model currently resolved at the organization scope
    And no per-feature selectors are visible until I expand a line

  @integration
  Scenario: Each role line shows the effective model and where it comes from
    Given the organization seeded "openai/gpt-5.5" for the Default role on onboarding
    When I view the Default role line
    Then I see "openai/gpt-5.5" next to the role name
    And a subtle hint reads "from organization"

  # ============================================================================
  # Expanding a role line surfaces the platform features that consume it
  # ============================================================================

  @integration
  Scenario: Expanding the Fast role shows every feature that consumes it
    Given the Fast role's effective model is "openai/gpt-5.4-mini"
    When I expand the Fast line
    Then I see one row per registered feature whose role is "fast"
    And each row shows the feature's display name and a model selector
    And the selector reads "inherits Fast (openai/gpt-5.4-mini)" when no override is set

  @integration
  Scenario: Embeddings never expands because it has no sub-features
    Given the Embeddings role is the only one consumed by "analytics.topic_clustering_embeddings"
    When I view the Embeddings line
    Then there is no expand chevron on the Embeddings line
    And the single role-level selector is sufficient

  # ============================================================================
  # Per-feature override
  # ============================================================================

  @integration @unimplemented
  Scenario: Overriding a single feature does not touch the role default
    Given the Fast role resolves to "openai/gpt-5.4-mini" via the organization
    When I expand the Fast line
    And I pick "anthropic/claude-sonnet-4-6" for "traces.ai_search"
    Then the AI Search row shows "anthropic/claude-sonnet-4-6" with hint "feature override"
    And every other Fast feature still shows "inherits Fast (openai/gpt-5.4-mini)"
    And the Fast role line itself still reads "openai/gpt-5.4-mini"

  @integration @unimplemented
  Scenario: Clearing a feature override restores the role-default inheritance
    Given "traces.ai_search" has a feature override "anthropic/claude-sonnet-4-6"
    When I clear the AI Search override
    Then the AI Search row reverts to "inherits Fast (openai/gpt-5.4-mini)"
    And the feature override row no longer appears in the per-scope storage

  # ============================================================================
  # Scope override lines, reusing the model-provider scope chip pattern
  # ============================================================================

  @integration @unimplemented
  Scenario: Adding a scope override line spawns a sibling editor with a chip picker
    Given the page header shows only the organization-scope role lines
    When I click "Add scope override"
    Then a new line opens with a scope chip selector identical to the one in the Add Model Provider drawer
    And I can pick a team or a specific project as the scope
    And the new line carries its own three role selectors plus per-feature expand

  @integration @unimplemented
  Scenario: A project-scope override beats the org default for that project only
    Given the organization line has Default "openai/gpt-5.5"
    When I add a scope override for project "web-app" and set Default to "anthropic/claude-sonnet-4-6"
    Then project "web-app" resolves "anthropic/claude-sonnet-4-6" as Default
    And every other project in the org still resolves "openai/gpt-5.5"

  @integration @unimplemented
  Scenario: A team-scope override sits between org and project
    Given the organization line has Default "openai/gpt-5.5"
    And team "platform" has a scope override with Default "openai/gpt-4o"
    And project "web-app" has no scope override
    Then project "web-app" resolves "openai/gpt-4o" with hint "from team platform"

  @integration @unimplemented
  Scenario: Removing a scope override falls back to the next scope up
    Given project "web-app" has a Default override of "anthropic/claude-sonnet-4-6"
    When I delete the project-scope override line
    Then project "web-app" resolves whatever the team or organization defines for Default

  # ============================================================================
  # Disabling the provider that backs a configured role
  # ============================================================================

  @integration @unimplemented
  Scenario: Deleting the provider that backed a configured role leaves the role visibly broken
    Given the organization's Fast role was set to "openai/gpt-5.4-mini"
    And OpenAI is the only provider that offers "openai/gpt-5.4-mini"
    When I delete the OpenAI provider row
    Then the Fast role line shows an inline warning that the configured model is no longer available
    And the line carries a "Pick a model" CTA pointing at the role selector
    And any feature consuming Fast throws ModelNotConfigured until the role is reconfigured

  # ============================================================================
  # Empty state and onboarding seed
  # ============================================================================

  @integration @unimplemented
  Scenario: A fresh organization with no providers shows an empty state and a setup link
    Given the organization has no model providers enabled yet
    When I open the Default Models section
    Then I see an empty state explaining that a model provider must be added first
    And the empty state links to "Add Model Provider"

  @integration @unimplemented
  Scenario: Enabling a provider on onboarding seeds the roles it can fulfill
    Given the organization has just enabled OpenAI on onboarding
    Then the Default role is seeded with the OpenAI flagship model
    And the Fast role is seeded with the OpenAI mini model
    And the Embeddings role is seeded with the OpenAI embeddings model
    And the Default Models section reflects the seeded values without further user action

  @integration @unimplemented
  Scenario: Onboarding a provider that does not offer embeddings only seeds the roles it can fulfill
    Given the organization has just enabled Anthropic on onboarding and has no other provider
    Then the Default role is seeded with the Anthropic sonnet flagship
    And the Fast role is seeded with the Anthropic haiku mini
    And the Embeddings role line is shown unconfigured with an inline link to enable an embeddings-capable provider
    And resolving an embeddings feature for this organization throws ModelNotConfiguredError until another provider is added

  # ============================================================================
  # Out of scope for this PR (kept here for future binding)
  # ============================================================================

  @integration @unimplemented
  Scenario: The selector for a scope only offers models from providers enabled at that scope
    Given the organization has only an OpenAI provider at org scope
    And project "web-app" has its own private Anthropic provider at project scope
    When I open the project-scope role line for "web-app"
    Then the Default selector offers both OpenAI and Anthropic models
    And the org-scope role line still offers only OpenAI models
