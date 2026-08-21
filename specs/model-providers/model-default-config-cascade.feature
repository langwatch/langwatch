Feature: Model default config cascade
  As a developer reaching for a model from any feature in the platform
  I want one resolver that walks the scope chain and merges configs CSS-style
  So that "set once at the org, override per team or project, override per feature when needed" reads exactly like a stylesheet and Add Override is the same drawer every time.

  # Replaces the row-per-(scope, role, featureKey) shape that B3.1 shipped.
  # See specs/model-providers/model-resolver-and-registry.feature for the
  # registry semantics (those are unchanged). The on-disk shape and the
  # cascade rules are the only things that move.
  #
  # ────────────────────────────────────────────────────────────────────────────
  # Concepts
  # ────────────────────────────────────────────────────────────────────────────
  #
  # ModelDefaultConfig:
  #   One row = one policy. Holds a single JSON `config` payload that maps
  #   feature keys (or role-level keys) to a model id. A config is NOT
  #   tied to a single scope — it attaches to N scopes via the join table
  #   so one configured "Production models" policy can apply to Team A +
  #   Team B + Project X with one row of state to maintain.
  #
  # ModelDefaultConfigScope:
  #   Join row binding a config to a (scopeType, scopeId). The same
  #   (configId, scopeType, scopeId) cannot appear twice, and a
  #   (scopeType, scopeId) belongs to at most ONE config: every write
  #   path that attaches a scope first detaches it from whichever config
  #   held it before (deleting configs left with zero scopes), under the
  #   same per-scope advisory lock the role/feature setters use. Two
  #   rows for the same scope in the settings table was never readable:
  #   the newer config shadowed the older one key-by-key while both
  #   rows rendered the shadowed result. The resolver still tiebreaks
  #   same-scope configs by createdAt DESC as defense for data written
  #   before this invariant existed.
  #
  # config JSON shape:
  #   {
  #     "DEFAULT": "openai/gpt-5.5",
  #     "FAST": "openai/gpt-5.4-mini",
  #     "EMBEDDINGS": "openai/text-embedding-3-small",
  #     "prompt.create_default": "openai/gpt-5.5",
  #     "traces.ai_search": "anthropic/claude-sonnet-4-6"
  #   }
  #
  #   Top-level keys are either role names (DEFAULT/FAST/EMBEDDINGS) or
  #   feature keys from the registry. ABSENCE of a key means "inherit
  #   from the next scope up" — there is no explicit "inherit" sentinel.
  #   That keeps storage lean and the merge logic obvious.
  #
  # Resolution walk for (featureKey, role) at projectId:
  #   1. Load every config attached at PROJECT scope for projectId.
  #   2. Load every config attached at TEAM scope for project's team.
  #   3. Load every config attached at ORGANIZATION scope for project's org.
  #   4. Within each scope tier, sort configs by createdAt DESC.
  #   5. Walk tier-by-tier (project → team → org), config-by-config (new
  #      → old). The first config that has the featureKey set wins for
  #      "feature override". If none has the featureKey, the first
  #      config that has the role set wins for "role default". Same
  #      first-set-key-wins per scope tier, but lower tier always beats
  #      higher tier even if higher tier was created later.
  #   6. ModelNotConfiguredError. There is intentionally no global
  #      system fallback. If nothing in the cascade carries the role,
  #      AI features for that role are disabled at that scope until the
  #      user configures a default; the frontend tRPC interceptor maps
  #      the thrown error to a sticky toast prompting an update.

  Background:
    Given a project belongs to a team in an organization
    And the feature registry declares features bound to DEFAULT, FAST, and EMBEDDINGS roles

  # ────────────────────────────────────────────────────────────────────────────
  # Cascade walk
  # ────────────────────────────────────────────────────────────────────────────

  @integration
  Scenario: An empty database throws ModelNotConfiguredError
    Given no ModelDefaultConfig rows exist anywhere
    And the legacy B2 scalar columns are unset on every scope (prod-sim)
    When I resolve "prompt.create_default" for any project
    Then the resolver throws ModelNotConfiguredError
    # There is no global system fallback. AI features for the DEFAULT
    # role are disabled at this project until the user configures one
    # at PROJECT, TEAM, or ORGANIZATION scope. The frontend tRPC
    # interceptor maps the error to a sticky toast prompting an update.

  @integration
  Scenario: An org-scoped config sets the DEFAULT for every project in that org
    Given an organization-scoped config { "DEFAULT": "openai/gpt-5.5" }
    And no team-level or project-level config exists
    When I resolve "prompt.create_default" for any project in that organization
    Then the resolver returns "openai/gpt-5.5"
    And source is "role_default"
    And scope is "organization"

  @integration
  Scenario: A project-scoped config wins over an org-scoped one for the same key
    Given an organization-scoped config { "DEFAULT": "openai/gpt-5.5" }
    And a project-scoped config { "DEFAULT": "openai/gpt-5.4-mini" } attached to that project
    When I resolve "prompt.create_default" for that project
    Then the resolver returns "openai/gpt-5.4-mini"
    And scope is "project"

  @integration
  Scenario: A feature override beats a role default at the same scope
    Given a project-scoped config { "FAST": "openai/gpt-5.4-mini", "traces.ai_search": "anthropic/claude-sonnet-4-6" }
    When I resolve "traces.ai_search" for that project
    Then the resolver returns "anthropic/claude-sonnet-4-6"
    And source is "feature_override"
    And scope is "project"

  @integration
  Scenario: Missing keys cascade up to the next scope tier
    Given an organization-scoped config { "DEFAULT": "openai/gpt-5.5", "FAST": "openai/gpt-5.4-mini" }
    And a project-scoped config { "DEFAULT": "anthropic/claude-sonnet-4-6" } attached to that project
    When I resolve a FAST-role feature for that project
    Then the resolver returns "openai/gpt-5.4-mini"
    And scope is "organization"
    # The project config carries no FAST key; cascade walks up to org.

  @integration
  Scenario: Legacy duplicate configs at the same scope resolve by created-at DESC
    Given a project has two configs both attached at PROJECT scope (written before the one-config-per-scope invariant):
      | created     | config                                |
      | 2026-05-01  | { "DEFAULT": "openai/gpt-5.4-mini" }  |
      | 2026-05-15  | { "DEFAULT": "openai/gpt-5.5" }       |
    When I resolve "prompt.create_default" for that project
    Then the resolver returns "openai/gpt-5.5"
    # Newer config wins on tie at the same scope tier. Write paths no
    # longer produce this state; the resolver keeps the tiebreak so
    # pre-invariant rows keep resolving deterministically until the
    # cleanup migration collapses them.

  @integration
  Scenario: A config can attach to many scopes at once
    Given a config { "DEFAULT": "openai/gpt-5.5" } attached to: project=web-app, project=api, team=Platform
    When I resolve "prompt.create_default" for project web-app
    Then the resolver returns "openai/gpt-5.5"
    And scope is "project"
    # Same config row, three scope attachments. Resolver picks the most-specific tier (project), and finds the config via the join row.

  @integration
  Scenario: A lower-tier config beats a newer higher-tier config
    Given an organization-scoped config { "DEFAULT": "openai/gpt-5.5" } created 2026-05-15
    And a project-scoped config { "DEFAULT": "openai/gpt-5.4-mini" } created 2026-05-01 attached to that project
    When I resolve "prompt.create_default" for that project
    Then the resolver returns "openai/gpt-5.4-mini"
    # Tier order (project → team → org) always beats created-at within a tier.

  # ────────────────────────────────────────────────────────────────────────────
  # Refusal-caused exhaustion (issue #6634, Gap 1)
  # ────────────────────────────────────────────────────────────────────────────
  #
  # A restricted (codex) model saved on a DEFAULT-role key is invisible to
  # this walk today because every write path already refuses it
  # (setRoleAtScope / setFeatureAtScope) — the state below is not reachable
  # through the product yet, but the resolver's own skip-and-continue
  # behavior (see the "restricted model" note above) means that IF it were
  # reached — a raw DB write, or a value legal when saved becoming
  # restricted later — the walk exhausted every tier and reported
  # ModelNotConfiguredError exactly as if nothing had ever been set. That is
  # a misdiagnosis: the user configured a value, it was refused. This
  # resolver-side fix distinguishes the two so a future write path, or a
  # future restriction on an already-saved value, reports the true cause.

  @unit
  Scenario: Exhaustion caused entirely by a restricted model reports the refusal, not "nothing configured"
    Given a project-scoped config whose DEFAULT role value is a restricted (codex) model
    And no wider-scope config carries the DEFAULT role or the feature key
    When I resolve a DEFAULT-role feature for that project
    Then the resolver throws ModelRestrictedForFeatureError
    And it does not throw ModelNotConfiguredError
    And the error names the restricted model

  @unit
  Scenario: Exhaustion caused by an unresolvable latest-alias still reports "nothing configured"
    Given a project-scoped config whose DEFAULT role value is a latest-alias with no concrete resolution
    And no wider-scope config carries the DEFAULT role or the feature key
    When I resolve a DEFAULT-role feature for that project
    Then the resolver throws ModelNotConfiguredError
    # An unresolvable alias is not a licensing refusal — conflating the two
    # would tell the user to change a model-restriction setting that isn't
    # their actual problem.

  @unit
  Scenario: A restricted DEFAULT-role value at project tier is skipped in favor of a wider tier
    Given a project-scoped config { "DEFAULT": "openai_codex/gpt-5.6-terra" }
    And an organization-scoped config { "DEFAULT": "openai/gpt-5-mini" }
    When I resolve a DEFAULT-role feature for that project
    Then the resolver returns "openai/gpt-5-mini"
    And source is "role_default"
    And scope is "organization"
    # The cascade still walks past a restricted value when a usable one
    # exists further up — ModelRestrictedForFeatureError is only thrown at
    # full exhaustion, exactly like ModelNotConfiguredError.

  # ────────────────────────────────────────────────────────────────────────────
  # Onboarding seed
  # ────────────────────────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: Enabling a provider on onboarding seeds one org-scope config
    Given a fresh organization with no ModelDefaultConfig rows
    When the onboarding flow enables the OpenAI provider at organization scope
    Then exactly one ModelDefaultConfig row exists with the org scope attached
    And the config JSON sets DEFAULT, FAST, and EMBEDDINGS to the registry's newest OpenAI flagship / mini / embedding model
    # Needs a real-DB integration suite (testcontainer). The pure-logic
    # plan builder is covered by buildSeedPlanForProvider tests; the
    # row-creation half lands in the langwatch-app-ci integration run
    # once the suite is added.

  @integration @unimplemented
  Scenario: Enabling a second provider does not replace the existing org config
    Given an organization-scoped config exists with { "DEFAULT": "openai/gpt-5.5" }
    When the user enables Anthropic on a later onboarding
    Then the existing config is unchanged
    And no second org-scope config is created from the seed
    # Onboarding is additive; only the first provider seeds. Subsequent
    # provider adds don't re-seed. Same DB-required gate as the
    # OpenAI-on-onboarding scenario above.

  # ────────────────────────────────────────────────────────────────────────────
  # Migration from the row-per-(scope,role,featureKey) shape
  # ────────────────────────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: Existing flat ModelDefault rows group into one config per scope on migration
    Given the previous schema had ModelDefault rows:
      | scopeType    | scopeId      | role        | featureKey                       | model              |
      | ORGANIZATION | org-acme     | DEFAULT     | null                             | openai/gpt-5.5     |
      | ORGANIZATION | org-acme     | FAST        | null                             | openai/gpt-5.4-mini|
      | ORGANIZATION | org-acme     | EMBEDDINGS  | null                             | openai/text-embedding-3-small |
      | PROJECT      | proj-web-app | FAST        | traces.ai_search                 | anthropic/claude-sonnet-4-6 |
    When the migration runs
    Then exactly two ModelDefaultConfig rows exist
    And the org config JSON is { DEFAULT, FAST, EMBEDDINGS } for the org-acme row
    And the project config JSON is { "traces.ai_search": "anthropic/claude-sonnet-4-6" } for proj-web-app
    And no ModelDefault rows remain (the old table is dropped)
    # Re-running the migration SQL inside a vitest would re-test SQL,
    # not our code — bound to the migration toolchain rather than a
    # code test.

  # ────────────────────────────────────────────────────────────────────────────
  # Write-side
  # ────────────────────────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: Saving a config with one scope creates one config + one scope row
    When I save a new config { "DEFAULT": "openai/gpt-5.5" } attached to organization "org-acme"
    Then one ModelDefaultConfig row exists with that JSON
    And one ModelDefaultConfigScope row exists pointing (ORGANIZATION, org-acme) at it
    # Write-side; needs real DB.

  # ────────────────────────────────────────────────────────────────────────────
  # One config per scope (customer report, 2026-08-13)
  # ────────────────────────────────────────────────────────────────────────────
  #
  # A customer set org-wide gpt defaults, then used "+ Add config" to
  # switch the org to gemini, and got a second org row instead of a
  # replacement. Both rows rendered the newer values (the resolver's
  # newest-wins tiebreak), so the older config became invisible and
  # uneditable-in-effect. Creating a config now CLAIMS its scopes:
  # whichever config previously held one of them loses that attachment.

  @integration
  Scenario: Creating a config at a scope that already has one replaces that scope's config
    Given an organization-scoped config { "DEFAULT": "openai/gpt-5.5" }
    When I save a new config { "DEFAULT": "gemini/gemini-2.5-pro" } attached to that organization
    Then only the new config remains attached at ORGANIZATION scope
    And the old config is deleted because it has no scopes left
    And resolving DEFAULT for a project in that organization returns "gemini/gemini-2.5-pro"

  @integration
  Scenario: Claiming a scope held by a multi-scope config detaches only that scope
    Given a config { "DEFAULT": "openai/gpt-5.5" } attached to projects "web-app" and "api"
    When I save a new config { "DEFAULT": "gemini/gemini-2.5-pro" } attached to project "web-app"
    Then the old config keeps its "api" attachment and its JSON
    And project "web-app" is attached only to the new config

  @integration
  Scenario: Adding a scope to an existing config claims it from its previous config
    Given an organization-scoped config { "DEFAULT": "openai/gpt-5.5" }
    And a project-scoped config { "DEFAULT": "openai/gpt-5.4-mini" } attached to project "web-app"
    When I update the org config's scope attachments to include project "web-app"
    Then the project config is deleted because it has no scopes left
    And project "web-app" is attached only to the org config

  # ────────────────────────────────────────────────────────────────────────────
  # Write-side error paths (part of the same customer report: saving an
  # all-inherit new config surfaced as a raw "unknown error" 500)
  # ────────────────────────────────────────────────────────────────────────────

  @integration
  Scenario: Saving a brand-new config with every key on Inherit is refused with a handled error
    When I save a new config with an empty JSON payload attached to an organization
    Then the save fails with a handled "validation_error" and not an unknown 500
    And no ModelDefaultConfig row is created

  @integration
  Scenario: Saving into a scope the caller cannot manage is refused with a handled error
    Given a caller without "organization:manage" on the organization
    When they save a config attached to ORGANIZATION scope
    Then the save fails with a handled "model_default_scope_forbidden" error carrying a 403
    And no ModelDefaultConfig row is created

  @integration
  Scenario: Migration collapses pre-invariant duplicate configs per scope
    Given two configs attached to the same (ORGANIZATION, org-acme) scope
    And a third config attached to org-acme and to a project no one else holds
    And two more configs sharing one created-at on the same team scope
    When migration 20260814120000_collapse_duplicate_model_default_scopes runs
    Then only the newest config keeps the org-acme attachment
    And the older config is deleted when it has no other attachment
    And the third config survives with only the project attachment
    And the team scope keeps the config with the higher id
    # The keep-newest rule matches the resolver tiebreak, so resolution
    # results do not change. Bound by replaying the shipped statements
    # against real Postgres, so editing the rule out of the migration
    # fails the test.

  @integration @unimplemented
  Scenario: Saving a config attached to many scopes creates one config + N scope rows
    When I save a new config { "DEFAULT": "openai/gpt-5.5" } attached to:
      | scopeType | scopeId  |
      | TEAM      | platform |
      | TEAM      | research |
      | PROJECT   | web-app  |
    Then one ModelDefaultConfig row exists with that JSON
    And three ModelDefaultConfigScope rows exist, one per scope

  @integration @unimplemented
  Scenario: Updating a config does NOT change its createdAt
    Given an existing config created 2026-05-01
    When I update its JSON to add a new role default
    Then the config's createdAt is unchanged
    And the updatedAt is bumped
    # createdAt is the tiebreak for same-scope ordering; updating must
    # not promote an old config to "newest at this scope". Exercised by
    # the updateConfig service implementation but a real-DB binding
    # would re-test Prisma's @updatedAt convention rather than our code.

  @integration @unimplemented
  Scenario: Deleting a config also deletes its scope attachments
    Given a config attached to two projects
    When I delete the config
    Then the config row is gone
    And no ModelDefaultConfigScope rows reference it
    # Cascade-delete on the FK — bound to the FK declaration in
    # ModelDefaultConfigScope (onDelete: Cascade), not a code path.

  # ────────────────────────────────────────────────────────────────────────────
  # Inherit semantics (UI <-> storage contract)
  # ────────────────────────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: The UI's "Inherit" choice is encoded as key absence in JSON
    Given a project-scoped config { "DEFAULT": "openai/gpt-5.5", "FAST": "openai/gpt-5.4-mini" }
    When the user changes FAST to "Inherit (from organization)"
    And saves the config
    Then the config JSON becomes { "DEFAULT": "openai/gpt-5.5" }
    And no "inherit" string is stored anywhere
    # Absence = inherit; lean storage; merge logic stays trivial.
    # The drawer-to-server round-trip + JSON storage shape — bind via
    # the drawer integration test once the inherit-dropdown lands.

  @integration
  Scenario: Editing an existing config to all-Inherit deletes it
    Given a project-scoped config { "DEFAULT": "openai/gpt-5.5" }
    When the user sets every key to Inherit and saves
    Then the config row is deleted
    And its scope attachments are gone
    # An attached-but-empty config has no effect on resolution but still
    # occupies the same-scope slot, so the write path treats it as a
    # delete. The drawer's toast says the config was removed, not
    # "updated"; see role-based-default-models.feature.

  @integration
  Scenario: Inherit row is a real, selectable option in the model picker
    Given the model picker is mounted inside the override drawer with an inheritOption present
    When I open the dropdown and click the "Inherit (from organization)" row
    Then the picker's onChange fires with the inherit sentinel
    And the drawer treats the sentinel as "delete this key from the in-progress JSON"
    # The inherit row is a real list entry so keyboard navigation and
    # screen readers reach it the same way as any model id. Storing the
    # sentinel as a delete is what keeps the absence-equals-inherit
    # contract from leaking into the UI layer.
