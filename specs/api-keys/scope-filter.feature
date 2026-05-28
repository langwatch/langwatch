Feature: API Keys scope filter
  As a user managing API keys across an organization
  I want to filter the API keys list by the scope they grant access to
  So that I can focus on one branch of the org tree without losing the parent / child rows that resolve through it

  # Implementation notes (non-runnable, document the design constraint behind
  # this feature — kept here so future readers know why client-side filtering
  # is safe):
  #   - The API Keys list query returns each key with its full set of
  #     roleBindings (scopeType + scopeId).
  #   - The list is returned in one shot (no pagination), so client-side
  #     filtering does not silently miss matching keys.
  # See specs/api-keys/unified-api-keys.feature for the user-perspective
  # contract of the list view.

  Background:
    Given I am signed in as a user in an organization
    And the organization has at least one team and at least one project
    And there are API keys with role bindings at the organization, team, and project scope

  # ============================================================================
  # Default view: everything I can see
  # ============================================================================
  # The default selection preserves today's behaviour — no rows are hidden until
  # the user explicitly narrows the filter.

  @integration
  Scenario: Filter defaults to "All you can see"
    When I navigate to Settings > API Keys
    Then the filter control in the header reads "All you can see"
    And the table includes every API key the current user has access to
    And the filter control is positioned in the header row alongside "+ Create new secret key", matching the layout of the model-providers page (filter on the right side of the header row, before the Create button — same precedent)

  @integration
  Scenario: Selecting "All you can see" shows every visible key regardless of scope
    Given I have API keys with role bindings at organization, team, and project scope
    When I navigate to Settings > API Keys with the filter set to "All you can see"
    Then the table includes keys whose only binding is at organization scope
    And the table includes keys whose only binding is at team scope
    And the table includes keys whose only binding is at project scope

  # ============================================================================
  # Dropdown options mirror DefaultModelsScopeFilter
  # ============================================================================

  @integration
  Scenario: Scope filter dropdown offers the same options as the model-providers page
    When I open the API Keys scope filter dropdown
    Then I see an "All you can see" option
    And I see a "This Team" option (when a current team is in context)
    And I see a "This Project" option (when a current project is in context)
    And I see a "More Scopes" submenu
    And the "More Scopes" submenu lists the organization, every team I can manage, and every project I can manage

  # ============================================================================
  # Inclusive cascade — picking a scope keeps the matching branch of the tree
  # ============================================================================
  # A single API key can have multiple role bindings (e.g. one at org + one at
  # a specific project). A key is visible if ANY of its bindings match the
  # cascade rule below. This mirrors the model-providers scope filter exactly.

  @integration
  Scenario: Picking the organization keeps every key bound anywhere in that org
    When I change the scope filter to the organization
    Then the table keeps keys with at least one organization-scoped binding
    And the table keeps keys with at least one team-scoped binding in that org
    And the table keeps keys with at least one project-scoped binding in that org

  @integration
  Scenario: Picking a team keeps org-scoped parents, the team itself, and its child projects
    When I change the scope filter to a specific team
    Then the table keeps keys with an organization-scoped binding (parent of the team)
    And the table keeps keys with a binding on the picked team
    And the table keeps keys with a binding on any project whose parent team is the picked team
    And the table hides keys whose only bindings are on sibling teams or on projects under other teams

  @integration
  Scenario: Picking a project keeps org-scoped grand-parents, the project's parent team, and the project itself
    When I change the scope filter to a specific project
    Then the table keeps keys with an organization-scoped binding (grand-parent of the project)
    And the table keeps keys with a binding on the picked project's parent team
    And the table keeps keys with a binding on the picked project
    And the table hides keys whose only bindings are on sibling projects or unrelated teams

  @integration
  Scenario: A key with multiple bindings is visible if any binding matches the cascade
    Given an API key has bindings at the organization scope AND on an unrelated project
    When I change the scope filter to a team in the same organization
    Then the key remains visible because its organization-scoped binding matches the cascade

  # ============================================================================
  # Empty state when the filter narrows everything away
  # ============================================================================
  # The model-providers precedent does NOT currently show a "Show all" reset
  # link in its empty state (its `@unimplemented` scenario aspires to one).
  # To avoid divergent UX between the two pages, this spec matches today's
  # model-providers behaviour: a plain "no keys match this scope" empty state
  # with no reset link. Landing a "Show all" reset link is a follow-up that
  # must be done on both pages together — out of scope here.

  # No reset link is intentional: matches model-providers today. A "Show all" link is a follow-up that must land on both pages together.
  @integration
  Scenario: Filter with zero matches shows a plain empty state
    Given the current project has no project-only API keys
    And no parent team or organization-scoped keys exist either
    When I change the scope filter to the current project
    Then the table area shows an empty state explaining that no keys match the current scope
    And the empty state does NOT include a "Show all" / reset link (the user resets via the dropdown itself, matching model-providers today)

  # ============================================================================
  # Component reuse — DefaultModelsScopeFilter is lifted, not duplicated
  # ============================================================================

  @unit
  Scenario: The scope filter component is shared with the model-providers page
    # Verifiable by grepping imports: both pages import from the same path; no second scope-filter component file exists.
    Given the model-providers page already uses a controlled scope filter component with props value/onChange/available
    When this feature is implemented
    Then both api-keys/index and settings/model-providers import the ScopeFilter component from the same shared location
    And no parallel scope-filter component file is introduced alongside the shared one

  @unit
  Scenario: API Keys page reuses filterProvidersByScope directly — no parallel helper
    # Verifiable by grepping the call site: filterProvidersByScope is called with a roleBindings→scopes mapping;
    # no filterKeysByScope file or function exists. Cascade correctness is covered by the @integration scenarios above.
    Given filterProvidersByScope already accepts rows with a `scopes` array and applies the inclusive cascade via `.some()` (matches any binding)
    When this feature is implemented
    Then the api-keys page calls filterProvidersByScope directly, mapping each key's `roleBindings` → `scopes` at the call site
    And no `filterKeysByScope` wrapper function or file is introduced

  # ============================================================================
  # Scope hierarchy derivation — shared between both pages
  # ============================================================================

  @unit
  Scenario: The available-scopes derivation is shared between api-keys and model-providers
    # Verifiable by grepping imports: both pages import useAvailableScopes from the same path;
    # neither page contains an inline useMemo replicating the org/team/project derivation.
    Given today's model-providers page derives `available = { organization, teams, projects }` from the organization graph via a useMemo
    When this feature is implemented
    Then the derivation is extracted into a shared hook (e.g. useAvailableScopes(organization))
    And both api-keys/index and settings/model-providers import useAvailableScopes from the same shared location
    And neither page contains an inline useMemo duplicating the org/team/project derivation

  # ============================================================================
  # Filter persistence — URL only, no localStorage (matches model-providers)
  # ============================================================================

  @integration
  Scenario: Filter selection survives reload via the URL, not localStorage
    Given model-providers persists the scope filter selection in the URL query string (e.g. `?scope=TYPE:id`) and does NOT use localStorage
    When I change the API Keys scope filter to a specific team and reload the page
    Then the same team-scoped filter is reapplied from the URL on next render
    And no localStorage entry is written for the API Keys scope filter

  # ============================================================================
  # Accessibility
  # ============================================================================

  @integration
  Scenario: Scope filter dropdown is keyboard navigable
    When I focus the scope filter trigger and press Enter
    Then the dropdown menu opens
    And I can move between options with ArrowDown / ArrowUp
    And pressing Enter selects the focused option and closes the menu
    And pressing Escape closes the menu without changing the selection
