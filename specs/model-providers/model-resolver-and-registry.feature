Feature: Model resolver and feature registry
  As a developer reaching for a model from anywhere in the platform
  I want one resolver that maps a feature key to a configured model and one error type when nothing is configured
  So that every AI-powered feature picks the right model through the same call and surfaces the missing-model popup the same way.

  # The storage shape and the cascading walk live in
  # specs/model-providers/model-default-config-cascade.feature. This file
  # is laser-focused on the stable contract every caller depends on:
  # the ModelNotConfiguredError shape and the dev-facing registry
  # semantics that catch typos at module-load time.

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
  #   - Code-side declarations under `[gone] src/server/modelProviders/
  #     featureRegistry.ts`. Each declaration is { key, role, displayName,
  #     description }. Keys are snake_case, area-prefixed, and stable forever
  #     (never renamed, only deprecated).
  #
  # Resolver return shape: { model: string, source: 'feature_override' |
  # 'role_default' | 'constant', scope: 'project' | 'team' | 'organization' |
  # null }. UI surfaces the source+scope so users can see WHY a model is being
  # used.

  Background:
    Given a project belongs to a team in an organization
    And the feature registry declares features bound to DEFAULT, FAST, and EMBEDDINGS roles

  # ────────────────────────────────────────────────────────────────────────────
  # Error semantics
  # ────────────────────────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: ModelNotConfiguredError surfaces enough for the popup to render
    Given a feature "traces.ai_search" with no role default and no constant fallback
    When the resolver fails for that feature
    Then the error code is "MODEL_NOT_CONFIGURED"
    And the error carries featureKey "traces.ai_search"
    And the error carries role "FAST"
    And the error carries the featureDisplayName "AI search"
    And the error carries the projectId used in the resolve call
    # FAST has a built-in constant today so this scenario can't fire
    # without a temporary "constant-removed" test fixture. Bound via the
    # ModelNotConfiguredError class structure tested in
    # modelNotConfigured.trpc.unit.test.ts rather than a contrived
    # missing-constant case.

  @integration
  Scenario: A tRPC procedure forwards ModelNotConfiguredError as a typed TRPCError
    Given a tRPC procedure that resolves a model and calls the provider
    When the resolver throws ModelNotConfiguredError for "traces.ai_search"
    Then the procedure responds with a TRPCError of code "BAD_REQUEST"
    And the error data carries cause "MODEL_NOT_CONFIGURED"
    And the error data carries featureKey "traces.ai_search"
    And the error data carries role "FAST"
    # Middleware re-raises ModelNotConfiguredError as a BAD_REQUEST
    # TRPCError; the errorFormatter serialises the cause into
    # data.cause = { code, featureKey, featureDisplayName, role,
    # projectId } so the frontend interceptor (utils/trpcError.ts) can
    # render the missing-model popup.

  # A model named outright skips the cascade, so a missing or disabled
  # provider is not `model_provider_disabled` (which carries the scope its
  # swap toast reads) but its own code, and background callers stop on it.

  @unit
  Scenario: A named model whose provider is not set up is refused with a typed code
    Given the project has no provider row for "openai"
    When an execution handle is asked for "openai/gpt-5-mini" by name
    Then it is refused with the code "model_provider_unavailable" and reason "not_configured"

  @unit
  Scenario: A named model whose provider is turned off is refused with a typed code
    Given the project's "openai" provider is disabled
    When an execution handle is asked for "openai/gpt-5-mini" by name
    Then it is refused with the code "model_provider_unavailable" and reason "disabled"
    And the refusal is not reworded as a generic AI call failure

  @unit
  Scenario: A provider that refuses the request itself is marked as not worth retrying
    Given the provider answers a model call with a client error such as 400 or 401
    When the AI call wrapper rethrows it
    Then it is "ai_call_failed" and not retryable
    And background callers treat it as a permanent failure

  @unit
  Scenario: A provider failure a retry could fix stays retryable
    Given a model call fails with a 5xx, a 429, a timeout or a dropped connection
    When the AI call wrapper rethrows it
    Then it is "ai_call_failed" and retryable
    And background callers do not treat it as permanent

  @unit
  Scenario: A wrapped AI call failure keeps the code of the failure it wraps
    Given a model call fails with a handled error the wrapper does not pass through
    When the AI call wrapper rethrows it as "ai_call_failed"
    Then the wrapped error's code is still on the reason chain

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
    # The UI uses this to render the per-role drill-down in the drawer.
