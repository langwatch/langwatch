Feature: Model resolver and feature registry
  As a developer reaching for a model from anywhere in the platform
  I want one resolver that walks scope and roles to return the configured model
  So that every AI-powered feature picks the right model with one rule, the user
  sees a single popup when a model is missing, and adding a new AI feature is a
  one-line registry change instead of a code spelunking session.

  # ────────────────────────────────────────────────────────────────────────────
  # Concepts
  # ────────────────────────────────────────────────────────────────────────────
  #
  # Roles (3, fixed):
  #   - DEFAULT     — the workhorse. Used by features that create user content
  #                   (a new prompt, a new evaluator) or run high-stakes calls.
  #   - FAST        — the quick-smarty. Used by background and assistive
  #                   features (AI search, autocomplete, commit messages,
  #                   topic clustering LLM step, scenario generator).
  #   - EMBEDDINGS  — single line, no sub-features. Used wherever vectors are
  #                   needed (today: topic clustering vectors).
  #
  # Feature registry:
  #   - Code-side declarations under `langwatch/src/server/modelProviders/
  #     featureRegistry.ts`. Each declaration is { key, role, displayName,
  #     description }. Keys are snake_case, area-prefixed, and stable forever
  #     (never renamed, only deprecated).
  #
  # Storage:
  #   - `ModelDefault` table: one row per (scopeType, scopeId, role,
  #     featureKey?). `featureKey IS NULL` means the role-level default for
  #     that scope; populated `featureKey` means a per-feature override.
  #   - Two partial unique indexes (Postgres treats NULLs as distinct, so
  #     a single composite index with a nullable `featureKey` would not
  #     prevent two role-level rows for the same scope+role):
  #       UNIQUE (scopeType, scopeId, role)           WHERE featureKey IS NULL
  #       UNIQUE (scopeType, scopeId, role, featureKey) WHERE featureKey IS NOT NULL
  #
  # Resolution order (most-specific wins):
  #   1. ModelDefault row with featureKey at scope PROJECT
  #   2. ModelDefault row with featureKey at scope TEAM (project's team)
  #   3. ModelDefault row with featureKey at scope ORGANIZATION (project's org)
  #   4. ModelDefault role-level row at PROJECT
  #   5. ModelDefault role-level row at TEAM
  #   6. ModelDefault role-level row at ORGANIZATION
  #   7. Built-in constant for the role (when one exists)
  #   8. ModelNotConfiguredError(featureKey, role, projectId)
  #
  # Resolver return shape: { model: string, source: 'feature_override' |
  # 'role_default' | 'constant', scope: 'project' | 'team' | 'organization' |
  # null }. UI surfaces the source+scope so users can see WHY a model is being
  # used (matches the source-tracking we already do for the B2 page).

  Background:
    Given a project belongs to a team in an organization
    And the feature registry declares:
      | key                                 | role       |
      | prompt.create_default               | DEFAULT    |
      | evaluator.create_default            | DEFAULT    |
      | traces.ai_search                    | FAST       |
      | workflows.commit_message            | FAST       |
      | studio.autocomplete                 | FAST       |
      | scenarios.generator                 | FAST       |
      | analytics.topic_clustering_llm      | FAST       |
      | analytics.topic_clustering_embeddings | EMBEDDINGS |

  # ────────────────────────────────────────────────────────────────────────────
  # Resolution walk
  # ────────────────────────────────────────────────────────────────────────────

  @integration
  Scenario: A feature with nothing configured falls back to the built-in constant
    Given no ModelDefault rows exist for the project, its team, or its organization
    When I resolve "prompt.create_default" for the project
    Then the resolver returns the built-in DEFAULT constant
    And source is "constant"
    And scope is null

  @integration
  Scenario: A role-level org default propagates to every feature in that role
    Given an organization-scoped role-level DEFAULT model "openai/gpt-5.5"
    And no team-level or project-level override exists
    When I resolve "prompt.create_default" for any project in that organization
    Then the resolver returns "openai/gpt-5.5"
    And source is "role_default"
    And scope is "organization"

  @integration
  Scenario: A project-level role default beats an organization-level role default
    Given an organization-scoped DEFAULT model "openai/gpt-5.5"
    And a project-scoped DEFAULT model "openai/gpt-5.4-mini" for that project
    When I resolve "prompt.create_default" for that project
    Then the resolver returns "openai/gpt-5.4-mini"
    And source is "role_default"
    And scope is "project"

  @integration
  Scenario: A feature override beats every role-level default
    Given a project-scoped FAST model "openai/gpt-5.4-mini"
    And a project-scoped feature override "anthropic/claude-sonnet-4-5" for "traces.ai_search"
    When I resolve "traces.ai_search" for that project
    Then the resolver returns "anthropic/claude-sonnet-4-5"
    And source is "feature_override"
    And scope is "project"

  @integration
  Scenario: A team-level feature override beats an organization-level role default
    Given an organization-scoped FAST model "openai/gpt-5.4-mini"
    And a team-scoped feature override "anthropic/claude-haiku-4-5" for "studio.autocomplete"
    When I resolve "studio.autocomplete" for a project in that team
    Then the resolver returns "anthropic/claude-haiku-4-5"
    And source is "feature_override"
    And scope is "team"

  @integration
  Scenario: A sibling feature override does not leak across features
    Given a project-scoped feature override "openai/gpt-5.5" for "traces.ai_search"
    And no role-level default and no built-in constant for "studio.autocomplete"
    When I resolve "studio.autocomplete" for the project
    Then the resolver throws ModelNotConfiguredError
    And the error carries featureKey "studio.autocomplete"
    And the error carries role "FAST"

  # ────────────────────────────────────────────────────────────────────────────
  # Error semantics
  # ────────────────────────────────────────────────────────────────────────────

  @integration
  Scenario: ModelNotConfiguredError surfaces enough for the popup to render
    Given a feature "traces.ai_search" with no role default and no constant fallback
    When the resolver fails for that feature
    Then the error code is "MODEL_NOT_CONFIGURED"
    And the error carries featureKey "traces.ai_search"
    And the error carries role "FAST"
    And the error carries the featureDisplayName "AI search"
    And the error carries the projectId used in the resolve call

  @integration
  Scenario: A tRPC procedure forwards ModelNotConfiguredError as a typed TRPCError
    Given a tRPC procedure that resolves a model and calls the provider
    When the resolver throws ModelNotConfiguredError for "traces.ai_search"
    Then the procedure responds with a TRPCError of code "BAD_REQUEST"
    And the error data carries cause "MODEL_NOT_CONFIGURED"
    And the error data carries featureKey "traces.ai_search"
    And the error data carries role "FAST"
    # The frontend interceptor matches on cause === MODEL_NOT_CONFIGURED
    # and opens the missing-model modal with the role and feature in context.

  # ────────────────────────────────────────────────────────────────────────────
  # Onboarding seed
  # ────────────────────────────────────────────────────────────────────────────

  @integration
  Scenario: Enabling OpenAI during onboarding seeds Default, Fast and Embeddings
    Given a fresh organization with no ModelDefault rows
    When the onboarding flow enables the OpenAI provider at organization scope
    Then a role-level ModelDefault row exists for role=DEFAULT at organization scope
    And the model is the registry's newest plain `openai/gpt-<major>.<minor>` flagship
    And a role-level ModelDefault row exists for role=FAST at organization scope
    And the model is the registry's newest `openai/gpt-<major>.<minor>-mini` mini variant
    And a role-level ModelDefault row exists for role=EMBEDDINGS at organization scope
    And the model is the registry's newest `openai/text-embedding-*` model

  @integration
  Scenario: Enabling Anthropic during onboarding seeds Default and Fast (no embeddings)
    Given a fresh organization with no ModelDefault rows
    When the onboarding flow enables the Anthropic provider at organization scope
    Then a role-level ModelDefault row exists for role=DEFAULT at organization scope
    And the model is the registry's newest `anthropic/claude-sonnet-*` model
    And a role-level ModelDefault row exists for role=FAST at organization scope
    And the model is the registry's newest `anthropic/claude-haiku-*` model
    And NO EMBEDDINGS row is seeded for Anthropic
    # Anthropic does not ship an embeddings model; the user must enable another
    # provider for embeddings. The missing-model popup explains this when an
    # embeddings-consuming feature is triggered.

  @integration
  Scenario: Seeding does not overwrite an existing user choice
    Given a role-level ModelDefault for DEFAULT at organization scope set to "openai/gpt-5.5"
    When the user enables a second provider during a later onboarding
    Then the existing DEFAULT model is preserved unchanged
    And only roles without a row are seeded for the new provider
    # Onboarding is additive — it never silently replaces a configured value.

  # ────────────────────────────────────────────────────────────────────────────
  # Compat with B2's defaultModel / topicClusteringModel / embeddingsModel
  # ────────────────────────────────────────────────────────────────────────────

  @integration
  Scenario: Migration moves B2 columns into ModelDefault rows
    Given an organization with defaultModel="openai/gpt-5.5", topicClusteringModel="openai/gpt-5.2", embeddingsModel="openai/text-embedding-3-small"
    When the B3.1 migration runs
    Then a ModelDefault row exists with role=DEFAULT, featureKey=null, model="openai/gpt-5.5"
    And a ModelDefault row exists with role=FAST, featureKey="analytics.topic_clustering_llm", model="openai/gpt-5.2"
    And a ModelDefault row exists with role=EMBEDDINGS, featureKey=null, model="openai/text-embedding-3-small"

  @integration
  Scenario: Resolver falls back to legacy columns for one release
    Given the migration has run but a stale code path still wrote to Organization.defaultModel only
    And no ModelDefault row exists for the organization
    When I resolve "prompt.create_default" for a project in that organization
    Then the resolver returns the legacy `Organization.defaultModel` value
    And source is "role_default"
    And scope is "organization"
    # Compat layer is removed in the follow-up PR once we verify no writes
    # land on the legacy columns in production.

  @integration
  Scenario: Writes during the compat window go only to ModelDefault, never the legacy columns
    Given the migration has run and the resolver still reads from legacy columns as a fallback
    When any caller (tRPC, REST, onboarding seed) sets the Default model for an organization
    Then a ModelDefault row is created with role=DEFAULT, featureKey=null
    And the legacy `Organization.defaultModel` column value is left untouched
    # Locks the one-way drain: legacy columns are read-only fallback,
    # writes always land on the new shape. Removes the risk that a stale
    # call path keeps the legacy data alive past the compat window.

  # ────────────────────────────────────────────────────────────────────────────
  # Dev-facing registry semantics
  # ────────────────────────────────────────────────────────────────────────────

  @unit
  Scenario: Registering a feature key twice is a build-time failure
    When two declarations share the same featureKey
    Then the registry import throws at module load
    # Stable keys forever — accidental duplication must not silently
    # swallow one of the declarations.

  @unit
  Scenario: Looking up an unknown feature key throws
    When I call resolveModelForFeature with a featureKey not in the registry
    Then the call throws "Unknown feature key"
    # Callers must use the registry; ad-hoc string keys are not supported.

  @unit
  Scenario: featuresByRole returns every declaration for that role
    Given the registry declares 5 features under role=FAST
    When I call featuresByRole("FAST")
    Then I receive all 5 declarations in registration order
    # The UI uses this to render the expanded list under each role line.
