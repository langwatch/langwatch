Feature: Hierarchical default models across organization, team, and project
  As a user setting up LangWatch for an organization
  I want default models to be defined at org/team/project scope with inheritance
  So that a sensible default flows down without forcing every project to re-pick it

  # The default model selectors used to live inside the create/edit provider
  # drawer (one set of defaults per project). This feature describes the
  # redesigned page-level "Default Models" section that sits below the
  # providers list and lets the user pick defaults at any scope they can
  # manage. Resolution is project → team → org → constant fallback.

  Background:
    Given I am logged in
    And I have access to an organization with at least one team and project
    And I have "project:update" permission on the project
    And I have at least one enabled model provider

  # ============================================================================
  # Location: page-level section, not inside the drawer
  # ============================================================================

  @integration
  Scenario: Default models live in a section below the providers list, not in the drawer
    When I open the model providers settings page
    Then I see a "Default Models" section below the providers list
    And the create/edit provider drawer does not show the default-model selectors

  # ============================================================================
  # Scope-aware selection with inheritance
  # ============================================================================

  @integration @unimplemented
  Scenario: Setting an org-level default applies to every project in that organization
    Given no team or project default model is set
    When I set the organization's default model to "openai/gpt-5.5"
    Then every project in that organization resolves "openai/gpt-5.5" as its default model
    And the project-level effective default is labelled "inherited from organization"

  @integration @unimplemented
  Scenario: Project-level default overrides the org default for that project only
    Given the organization's default model is "openai/gpt-5.5"
    When I set project "web-app" default model to "anthropic/claude-sonnet-4-6"
    Then project "web-app" resolves "anthropic/claude-sonnet-4-6"
    And every other project in the org still resolves "openai/gpt-5.5"

  @integration @unimplemented
  Scenario: Team default sits between org and project in the resolution order
    Given the organization's default model is "openai/gpt-5.5"
    And team "platform" has its default model set to "openai/gpt-4o"
    And project "web-app" belongs to team "platform" with no project-level override
    Then project "web-app" resolves "openai/gpt-4o"

  @integration @unimplemented
  Scenario: Clearing a scope falls back to the next level up
    Given the organization's default model is "openai/gpt-5.5"
    And project "web-app" had its default model set to "anthropic/claude-sonnet-4-6"
    When I clear the project-level default
    Then project "web-app" resolves "openai/gpt-5.5" again

  # ============================================================================
  # Restriction: a scope can only pick from providers enabled at that scope
  # ============================================================================

  @integration @unimplemented
  Scenario: The org-level default model can only be a model from an org-scope provider
    Given the only OpenAI provider is scoped to project "web-app"
    When I open the organization-level default selector
    Then OpenAI models are not selectable
    And the helper text explains the provider is project-scoped

  @integration @unimplemented
  Scenario: A lower scope can override using a model from a provider at that lower scope
    Given the organization's default model is "openai/gpt-5.5"
    And project "web-app" has its own project-scoped Anthropic provider
    When I open the project-level default selector
    Then I can pick any Anthropic model offered by that project-scoped provider
    And the project-level default overrides the org default

  # ============================================================================
  # Effective-default surfacing
  # ============================================================================

  @integration @unimplemented
  Scenario: The page shows the effective default and where it comes from
    Given the team default is "openai/gpt-4o" and the project has no override
    When I view the Default Models section for project "web-app"
    Then I see "openai/gpt-4o" as the effective default
    And the source is labelled "inherited from team platform"
