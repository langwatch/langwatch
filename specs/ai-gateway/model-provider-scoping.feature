Feature: Cross-scope ModelProvider reuse
  As an operator administering the AI Gateway across multiple projects
  I want to assign a ModelProvider at the ORG / TEAM / PROJECT scope
  So that one OpenAI credential can serve every project in the org
  (or one team, or just one project) — matching the RBAC principal
  scope pattern — without duplicating keys or billing accounts.

  Ref: docs/ai-gateway/provider-bindings.mdx §Scope & access
  Driven by rchaves 2026-04-19 dogfood feedback + @andr iter 75 lane split.
  Data-plane Go gateway is UNCHANGED by this refactor — the bundle resolves
  GatewayProviderCredential by id, agnostic to the ModelProvider scope.

  Background:
    Given an organization "acme" with 3 projects ("acme-api", "acme-eval", "acme-pm")
      grouped into 2 teams ("acme-platform" (contains acme-api + acme-pm), "acme-ml" (contains acme-eval))
    And user "alice" has role ADMIN on "acme-platform" team + MEMBER on "acme-ml"
    And user "bob" has role MEMBER on "acme-pm" project only

  # ─────────────────────────────────────────────────────────────────────────
  # §1. Scope shape — where a ModelProvider lives
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: ModelProvider has exactly one scope field populated
    When an operator creates a ModelProvider at ORGANIZATION scope for "acme"
    Then the row has scopeType = "ORGANIZATION" and scopeId = the org id
    And the projectId, teamId scope columns are null
    And the UI's "Scope" column in Settings → Model Providers shows "Org: acme"

  Scenario: Existing ModelProvider rows default to PROJECT scope (zero-drift backwards compat)
    Given a ModelProvider exists pre-migration with only a projectId set
    When the 20260420xxxxxx_add_model_provider_scope migration runs
    Then the row gets scopeType = "PROJECT" and scopeId = the existing projectId
    And no operator has to re-enable anything

  # ─────────────────────────────────────────────────────────────────────────
  # §2. Reading — getAllAccessible resolves the scope ladder
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Project-scoped provider visible only to that project's bindings
    Given a ModelProvider "OpenAI-prod" at PROJECT scope on "acme-api"
    When I call modelProvider.getAllAccessible({ projectId: "acme-api" }) as alice
    Then the response includes "OpenAI-prod"
    When I call the same with projectId="acme-pm" as alice
    Then "OpenAI-prod" is NOT in the response (different project, no ladder walk)

  Scenario: Team-scoped provider visible to every project within the team
    Given a ModelProvider "OpenAI-platform" at TEAM scope on "acme-platform"
    When I call getAllAccessible for projectId="acme-api" (inside acme-platform) as alice
    Then "OpenAI-platform" is included
    When I call getAllAccessible for projectId="acme-pm" (also inside acme-platform)
    Then "OpenAI-platform" is included
    When I call getAllAccessible for projectId="acme-eval" (inside acme-ml)
    Then "OpenAI-platform" is NOT included

  Scenario: Org-scoped provider visible to every project under the org
    Given a ModelProvider "OpenAI-enterprise" at ORGANIZATION scope on "acme"
    When I call getAllAccessible for any projectId in the org
    Then "OpenAI-enterprise" is included
    And the binding picker labels it as "OpenAI (org: acme)"

  Scenario: Mixed-scope visibility composes
    Given ModelProviders at 3 scopes: ORG "OpenAI-ent", TEAM "OpenAI-plat", PROJECT "OpenAI-prod-only"
    When I call getAllAccessible as alice for projectId="acme-api" (team: acme-platform)
    Then the response contains all three entries (org + team + project all reachable)

  # ─────────────────────────────────────────────────────────────────────────
  # §3. Binding — the gateway picker surfaces scope
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Bind drawer lists providers from every scope with visible scope label
    Given the setup from the mixed-scope scenario above
    When alice opens /gateway/providers → Bind provider on "acme-api"
    Then the icon-tile list shows 3 entries
    And each entry's caption shows "Org: acme" / "Team: acme-platform" / "Project: acme-api" respectively
    And hovering an entry shows a tooltip with the scope-ladder rationale

  Scenario: Creating a binding stores the source-provider reference, not a copy
    When alice creates a GatewayProviderCredential binding to "OpenAI-enterprise" (ORG scope)
    Then GatewayProviderCredential.modelProviderId = "OpenAI-enterprise".id
    And the provider's API key is NOT duplicated — it stays in the ORG-scoped ModelProvider row
    And rotating the key at Settings → Model Providers propagates to every binding that references it on the next /changes refresh (≤ 30 s)

  # ─────────────────────────────────────────────────────────────────────────
  # §4. Permission — who can create at each scope
  # ─────────────────────────────────────────────────────────────────────────

  Scenario Outline: Create-at-scope requires the matching permission
    Given user "<user>" has role "<role>" on "<scope-target>"
    When they POST /api/settings/model-providers with scopeType="<scope>" scopeId="<id>"
    Then the response is "<expected>"

    Examples:
      | user  | role      | scope-target        | scope         | id            | expected              |
      | alice | ADMIN     | acme (org)          | ORGANIZATION  | acme          | 201 created           |
      | alice | ADMIN     | acme-platform       | TEAM          | acme-platform | 201 created           |
      | alice | ADMIN     | acme-platform       | PROJECT       | acme-api      | 201 created           |
      | alice | ADMIN     | acme-platform       | TEAM          | acme-ml       | 403 permission_denied |
      | bob   | MEMBER    | acme-pm             | PROJECT       | acme-pm       | 403 permission_denied (MEMBER < manage) |
      | bob   | MEMBER    | acme-pm             | ORGANIZATION  | acme          | 403 permission_denied (MEMBER < org admin) |

  Scenario: Downgrading a user's role immediately hides previously-visible scopes
    Given alice had ADMIN on acme-platform and therefore saw "OpenAI-platform" TEAM-scoped provider
    When an org admin demotes alice to MEMBER on acme-platform
    Then the next call to getAllAccessible for acme-api no longer includes "OpenAI-platform" if the TEAM scope required manage
    # Security property: visibility follows current role, not role-at-token-issuance.

  # ─────────────────────────────────────────────────────────────────────────
  # §5. Existing bindings across a scope change
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Changing a ModelProvider's scope doesn't break existing bindings
    Given "OpenAI-prod" was PROJECT-scoped on "acme-api" with 3 bindings across 3 projects in the org
    When an org admin edits "OpenAI-prod" to ORGANIZATION scope
    Then all 3 bindings continue to resolve (they reference the provider by id, not by scope)
    And the /changes long-poll fires a bundle refresh marking scope-changed
    And operators can now create new bindings to "OpenAI-prod" from any project in the org

  Scenario: Restricting scope from ORG → PROJECT archives out-of-scope bindings
    Given "OpenAI-wide" was ORGANIZATION-scoped with bindings in 5 projects
    When an org admin narrows it to PROJECT scope on "acme-api" only
    Then the 4 bindings outside "acme-api" are automatically archived (archivedAt set)
    And a GatewayChangeEvent is emitted for each (kind = PROVIDER_BINDING_ARCHIVED)
    And the admin sees a confirmation modal before the narrow lands
    # Preserves the audit trail; never silent-revokes in a way operators can't reconstruct.

  # ─────────────────────────────────────────────────────────────────────────
  # §6. UI — Settings → Model Providers
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Settings page shows the scope column + scope-picker on create
    When I open Settings → Model Providers as an org admin
    Then each row has columns: Provider | Scope | Rotation | Enabled | Created
    And the "New provider" drawer has a Scope picker with three radios: Project / Team / Organization
    And selecting "Team" reveals a secondary dropdown listing teams I manage
    And selecting "Organization" is gated — button disabled + tooltip "Requires organization admin" when the user lacks the permission

  Scenario: Filtering the list by scope
    Given I have 10 providers across all three scopes
    When I select "Scope: Team" filter on the Settings page
    Then only TEAM-scoped providers are listed
    And the filter shows up in the URL query (?scope=TEAM) for shareable-link debugging

  # ─────────────────────────────────────────────────────────────────────────
  # §7. Default Model — same scope ladder
  # ─────────────────────────────────────────────────────────────────────────
  # Driven by rchaves 2026-04-19 iter 107 follow-up: "model providers AND
  # default model configs etc" — Default Model config mirrors the provider
  # scope ladder so an org-admin can set one default for the whole org and
  # teams/projects override only when they need to.

  Scenario: Default Model inherits org → team → project (first-match-wins)
    Given an ORG-scoped Default Model "openai/gpt-5-mini" set at "acme"
    And no team or project override on "acme-api"
    When a consumer on "acme-api" calls openai.chat.completions.create() with no explicit model param
    Then the resolved model is "openai/gpt-5-mini"

  Scenario: Project override beats team + org default
    Given an ORG-scoped Default Model "openai/gpt-5-mini" on "acme"
    And a TEAM-scoped Default Model "anthropic/claude-haiku-4-5" on "acme-platform"
    And a PROJECT-scoped Default Model "gemini/gemini-2.5-flash" on "acme-api"
    When a consumer on "acme-api" calls with no explicit model
    Then the resolved model is "gemini/gemini-2.5-flash" (project beats team beats org)
    When the same consumer runs on "acme-pm" (also in acme-platform, no project override)
    Then the resolved model is "anthropic/claude-haiku-4-5" (team beats org)
    When the same consumer runs on "acme-eval" (acme-ml team, no team or project override)
    Then the resolved model is "openai/gpt-5-mini" (falls back to org)

  Scenario: Default Model migration is zero-drift
    Given a Default Model exists pre-migration with only a projectId set
    When the scope migration runs
    Then the row gets scopeType = "PROJECT" and scopeId = the existing projectId
    And callers on that project see the same resolved model as before

  # ─────────────────────────────────────────────────────────────────────────
  # §8. Write-path UI — matches @alexis iter 108 Lane B slice
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Scope picker on the create drawer gates each radio by permission
    Given alice has MEMBER on "acme" org, ADMIN on team "acme-platform", ADMIN on project "acme-api"
    When alice opens Settings → Model Providers → New provider
    Then the Scope radio group shows three options: Project / Team / Organization
    And "Organization" is disabled with tooltip "Requires organization admin"
    And "Team" is enabled and reveals a team dropdown that lists only "acme-platform"
    And "Project" is enabled and reveals a project dropdown listing projects she can manage
    And the default selection is "Project" (least-privilege default)

  Scenario: Scope picker on the edit drawer lets an admin widen or narrow scope
    Given a PROJECT-scoped provider "OpenAI-prod-only" on "acme-api"
    And alice is an org admin
    When alice opens the edit drawer and switches Scope from "Project" to "Organization"
    Then the form surfaces a warning banner explaining widening: "This provider will become available to every project in the org"
    When alice saves
    Then the provider row persists with scopeType="ORGANIZATION", scopeId=acme
    And the projectId column is cleared
    And all existing bindings still resolve because they reference the provider by id

  Scenario: Narrowing scope surfaces the archive confirmation
    Given an ORG-scoped provider "OpenAI-wide" with 5 bindings across 5 projects
    And alice is an org admin
    When she edits the scope down to "Project" on "acme-api"
    Then a confirmation modal lists the 4 bindings outside "acme-api" that will be archived
    And each row shows: project name, binding created-at, last used
    When alice confirms
    Then the narrow persists AND 4 GatewayChangeEvents are emitted (kind=PROVIDER_BINDING_ARCHIVED)
    # UX aligns with §5 semantics — never silent-revoke; always explicit.

  Scenario: Inherited rows render with the "override" affordance
    Given a TEAM-scoped provider "OpenAI-platform" on team "acme-platform"
    And no PROJECT-scoped provider override on "acme-api"
    When alice opens Settings → Model Providers scoped to project "acme-api"
    Then "OpenAI-platform" is listed with a gray background and a "Team: acme-platform" badge
    And an "Override at project scope" action is available in the row's kebab menu
    When she clicks "Override at project scope"
    Then the create drawer opens with Scope pre-selected to "Project" + scopeId="acme-api"
    And the form fields are pre-filled from the inherited row so the operator edits, not retypes

  Scenario: Scope badges on the list render transport-agnostic
    Given providers at ORG "OpenAI-ent", TEAM "OpenAI-plat", PROJECT "OpenAI-prod-only"
    When alice opens the Settings page filtered to "All providers"
    Then each row shows a Scope badge:
      | name             | badge                   |
      | OpenAI-ent       | "Org: acme"             |
      | OpenAI-plat      | "Team: acme-platform"   |
      | OpenAI-prod-only | "Project: acme-api"     |
    And the badge colour reflects the scope tier (org=blue, team=purple, project=gray)

  Scenario: Gateway binding drawer groups Select options by scope origin
    Given the setup from "Scope badges on the list render transport-agnostic"
    When alice opens Gateway → Providers → Bind provider on project "acme-api"
    Then the provider Select groups options by Scope heading:
      | group                     | options          |
      | Organisation (acme)       | OpenAI-ent       |
      | Team (acme-platform)      | OpenAI-plat      |
      | This project (acme-api)   | OpenAI-prod-only |
    And hovering any option shows the scope-ladder rationale (why this row is visible here)

  # ─────────────────────────────────────────────────────────────────────────
  # §9. Out of scope for this refactor
  # ─────────────────────────────────────────────────────────────────────────

  # - Per-provider ACL ("only these teams can bind against OpenAI-ent")
  #   deferred until a customer actually asks; default = every team/project
  #   in the org can bind against any org-scoped provider, matching
  #   RoleBinding visibility (@rchaves confirmation pending).
  # - Provider sharing across *organizations* is explicitly NOT supported.
  # - Data-plane Go gateway is untouched — bundle already resolves
  #   GatewayProviderCredential by id, which is agnostic to ModelProvider scope.
