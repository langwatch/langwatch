Feature: Role-based default models with per-scope overrides
  As a user setting up LangWatch
  I want one set of three Default Models at the top (Default, Fast, Embeddings) and a single flat list of overrides where each override targets one or more scopes (org, team, project) at once
  So that the page reads like the RBAC settings — current defaults at the top, a flat policy list below — and I never face a "one field per scope per role" wall

  # The data, resolver, and ModelNotConfiguredError shape live with B3.1
  # (specs/model-providers/model-resolver-and-registry.feature). This file
  # describes the settings UI in
  # `langwatch/src/components/settings/DefaultModelsSection.tsx` and the
  # tRPC payload that drives it.
  #
  # Mental model:
  #   - Main view = the three effective default models for the project,
  #     read-only display with a click-to-edit affordance and the "from
  #     organization / from team / built-in fallback" hint.
  #   - Overrides list = a flat array of assignments (RBAC-style). Each
  #     assignment is { role, featureKey?, model, scopes: [...] } where
  #     `scopes` mixes ORGANIZATION / TEAM / PROJECT entries freely. A
  #     single assignment can apply to Team A + Team B + Project X with
  #     the same model.
  #   - "+ Add override" opens a drawer where the user picks the
  #     scope(s) via the same ScopeChipPicker we ship in the model-
  #     provider drawer, then picks Default / Fast / Embeddings models
  #     and optionally drills into per-feature overrides.

  Background:
    Given I am logged in
    And I have access to an organization with at least one team and project
    And I have at least one enabled model provider on the organization

  # ============================================================================
  # Main view: current default models + overrides list
  # ============================================================================

  @integration
  Scenario: The Default Models section opens with the three effective lines
    When I open the model providers settings page
    Then below the providers list I see a "Default Models" section
    And the section shows exactly three lines: "Default", "Fast", "Embeddings"
    And each line shows the model currently resolved for this project
    And each line shows the inheritance hint (built-in / from organization / from team / from project)

  @integration
  Scenario: Each role line shows the effective model and where it comes from
    Given the organization seeded "openai/gpt-5.5" for the Default role on onboarding
    When I view the Default role line
    Then I see "openai/gpt-5.5" next to the role name
    And a subtle hint reads "from organization"

  @integration @unimplemented
  Scenario: Embeddings has no per-feature expand because it has a single consumer
    # In the flat-rules-list UX there is no per-role expand chevron;
    # the Embeddings role's effective value renders as a normal row.
    # Kept here for parity with the pre-redesign spec language.
    Given the Embeddings role is consumed only by "analytics.topic_clustering_embeddings"
    When I view the Embeddings line
    Then no expand chevron is shown on the Embeddings line

  # ============================================================================
  # The flat overrides list (RBAC-style assignments)
  # ============================================================================

  @integration
  Scenario: The overrides list shows one row per assignment, each row with its scope chips
    Given the organization has an assignment {role=DEFAULT, model="openai/gpt-5.5", scopes=[organization]}
    And an assignment {role=DEFAULT, model="anthropic/claude-sonnet-4-6", scopes=[team:Platform, project:web-app]}
    When I open the Default Models section
    Then I see two rows under "Overrides"
    And the first row shows "openai/gpt-5.5" with one chip "Organization"
    And the second row shows "anthropic/claude-sonnet-4-6" with two chips "Team Platform" and "Project web-app"
    # The two rows above are one ModelDefault row per scope under the
    # hood. The server groups by (role, featureKey, model) so the UI
    # renders one logical "assignment" per group with the scopes as
    # chips on the same row.

  @integration
  Scenario: Adding an override opens a drawer with a scope chip picker and per-role model selectors
    When I click "+ Add override"
    Then a drawer opens
    And the drawer shows a ScopeChipPicker so I can pick one or more scopes (organization, teams, projects)
    And the drawer shows a Default / Fast / Embeddings model selector
    And the drawer optionally drills into per-feature overrides

  @integration
  Scenario: Editing an assignment row opens the drawer pre-filled with that rule
    Given an existing per-feature override targets "traces.ai_search" at project scope
    When I click the row's Edit button
    Then the drawer opens with the feature pre-selected and the Delete CTA enabled

  @integration @unimplemented
  Scenario: Saving a multi-scope override creates one ModelDefault row per scope but renders as one assignment
    Given I open the override drawer
    When I pick scopes Team Platform + Project web-app
    And I set Default to "anthropic/claude-sonnet-4-6"
    And I save the drawer
    Then two ModelDefault rows are created (one TEAM, one PROJECT) sharing the same model
    And the overrides list shows ONE row with two chips and the model "anthropic/claude-sonnet-4-6"

  @integration @unimplemented
  Scenario: Removing a chip from an assignment row deletes only that ModelDefault row
    Given an assignment "openai/gpt-5.5" with chips [Team Platform, Team Research, Project web-app]
    When I remove the "Team Research" chip from the row
    Then the ModelDefault row at (scope=TEAM, scopeId=research-team-id) is deleted
    And the other two scopes keep their assignment
    And the resolver for projects in the Research team no longer sees "openai/gpt-5.5" via that override

  @integration @unimplemented
  Scenario: Editing the model on an assignment row bulk-updates every ModelDefault in that group
    Given an assignment "openai/gpt-5.5" with chips [Team Platform, Project web-app]
    When I change the model on the row to "anthropic/claude-sonnet-4-6"
    Then both ModelDefault rows update their model to "anthropic/claude-sonnet-4-6"
    And the overrides list still shows ONE row with both chips

  @integration @unimplemented
  Scenario: A project-scope override beats the org default for that project only
    Given the organization line has Default "openai/gpt-5.5"
    When I add an override with scope=Project web-app and Default="anthropic/claude-sonnet-4-6"
    Then project "web-app" resolves "anthropic/claude-sonnet-4-6" as Default
    And every other project in the org still resolves "openai/gpt-5.5"

  @integration @unimplemented
  Scenario: A team-scope override sits between org and project
    Given the organization line has Default "openai/gpt-5.5"
    And team "Platform" has an override with Default "openai/gpt-4o"
    And project "web-app" has no override
    Then project "web-app" resolves "openai/gpt-4o" with hint "from team Platform"

  @integration @unimplemented
  Scenario: Deleting an override row removes every scope's ModelDefault for that group
    Given an override "anthropic/claude-sonnet-4-6" with chips [Team Platform, Project web-app]
    When I delete the override row
    Then both ModelDefault rows are removed
    And the resolver falls back to the next scope up

  # ============================================================================
  # Per-feature overrides
  # ============================================================================

  @integration @unimplemented
  Scenario: Overriding a single feature does not touch the role default
    Given the Fast role resolves to "openai/gpt-5.4-mini" via the organization
    When I add an override targeting feature "traces.ai_search" with model "anthropic/claude-sonnet-4-6"
    Then the new override row shows "AI search" as its feature label
    And the Fast role line itself still reads "openai/gpt-5.4-mini"
    And every other Fast feature still resolves "openai/gpt-5.4-mini"

  @integration @unimplemented
  Scenario: Clearing a feature override restores the role-default inheritance
    Given "traces.ai_search" has a feature override "anthropic/claude-sonnet-4-6"
    When I clear the override row
    Then "traces.ai_search" resolves the Fast role default again

  # ============================================================================
  # RBAC: only scopes you can manage show up in the chip picker
  # ============================================================================

  @integration @unimplemented
  Scenario: The drawer's chip picker only offers scopes the caller can manage
    Given I have "team:manage" on Team Platform only
    And I have "project:update" on Project web-app only
    When I open the override drawer
    Then the chip picker offers Team Platform and Project web-app
    And it does NOT offer Team Research (no team:manage)
    And it does NOT offer the organization scope (no organization:manage)

  # ============================================================================
  # Onboarding seed
  # ============================================================================

  @integration @unimplemented
  Scenario: Enabling a provider on onboarding seeds the roles it can fulfill
    Given the organization has just enabled OpenAI on onboarding
    Then the Default role is seeded with the OpenAI flagship model
    And the Fast role is seeded with the OpenAI mini model
    And the Embeddings role is seeded with the OpenAI embeddings model
    And the Default Models section reflects the seeded values without further user action

  @integration
  Scenario: The user's onboarding pick wins over the additive seed
    Given the additive seed wrote "openai/gpt-5.5" for the Default role at organization scope
    When the same submit carries a user-picked Default model "openai/gpt-4o"
    Then the ModelDefault row for (Default, organization) is upserted to "openai/gpt-4o"
    And the registry-flagship value the seed wrote no longer appears in the rules list

  @integration
  Scenario: Toggling "Set as default" off does not write any ModelDefault row
    Given the provider create submit carries useAsDefaultProvider=false
    Then no setRoleAssignmentForScope call fires
    And the seed remains the only writer of org-scope rows during this submit

  @integration @unimplemented
  Scenario: Onboarding a provider that does not offer embeddings only seeds the roles it can fulfill
    Given the organization has just enabled Anthropic on onboarding and has no other provider
    Then the Default role is seeded with the Anthropic sonnet flagship
    And the Fast role is seeded with the Anthropic haiku mini
    And the Embeddings role line is shown unconfigured with an inline link to enable an embeddings-capable provider
    And resolving an embeddings feature for this organization throws ModelNotConfiguredError until another provider is added

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
