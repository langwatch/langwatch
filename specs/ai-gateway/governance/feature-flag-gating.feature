Feature: Governance visibility rides a single feature flag
  The governance plane (personal keys, admin oversight, RoutingPolicy
  admin, IngestionSource setup, Activity Monitor) is controlled by ONE app
  feature flag, and that flag ships enabled by default: a fresh
  self-hosted installation (`npx @langwatch/server`, docker compose,
  `pnpm dev`) renders the governance surfaces and accepts AI-tools
  (device) CLI login with zero flag configuration. On SaaS, PostHog
  release conditions decide per organization, and switching an
  organization off re-arms every gate for it: UI hidden, device login
  refused. The unified `langwatch` CLI carries no preview gate: once
  installed the commands are always available, with per-account
  entitlement enforced server-side on the underlying API.

  Spec scope: the gating contract itself — what's hidden, when, and how
  operators control it. The default lives in
  `langwatch/src/server/featureFlag/registry.ts`; frontend exposure in
  `langwatch/src/server/featureFlag/frontendFeatureFlags.ts`; the CLI
  device-login gate in `langwatch/src/server/routes/auth-cli.ts`
  (ADR-038 Decision 7 pins the registry default and the gate fallback as
  a pair that moves together).

  Background:
    Given the canonical name is locked:
      | surface | name                                 |
      | App     | release_ui_ai_governance_enabled     |
    And the AI Gateway product itself ships unblocked on its own flag
      `release_ui_ai_gateway_menu_enabled` (separate concern, not gated)

  Scenario: A default installation enables governance without configuration
    Given a self-hosted installation with no PostHog key and no flag overrides
    When a user logs in and navigates the product
    Then the governance surfaces render (sidebar Govern section, /me)
    And an AI-tools (device) CLI login approval is not refused by the governance gate

  Scenario: The single app flag gates every governance UI surface when off
    Given a user logged into LangWatch
    And `release_ui_ai_governance_enabled` evaluates to false for them
    When they navigate the product
    Then none of the governance surfaces are reachable from the UI:
      | surface                            | path                              |
      | My Workspace dashboard             | /me                               |
      | My Workspace settings              | /me/settings                      |
      | Admin Routing Policies             | /settings/routing-policies        |
      | Admin Activity Monitor             | /settings/activity-monitor        |
      | Admin Provider Catalog             | /settings/providers               |
      | Admin IngestionSource setup        | /settings/ingestion-sources       |
      | "My Workspace" avatar dropdown link| (DashboardLayout user menu)        |
      | WorkspaceSwitcher (personal scope) | (top-bar context dropdown)         |
    And no governance API calls fire from the client
    And the existing AI Gateway menu still renders (different flag)

  Scenario: Operators force the flag off via env override
    Given an operator disables governance for the whole installation via env override
    When users log in
    Then every governance surface above is hidden
    And AI-tools (device) CLI login approvals are refused with a pointer at project login
    And no PostHog connection is required for the override to apply

  Scenario: Per-org kill switch via PostHog release condition
    Given an admin switches the governance flag off for one customer org via PostHog
    When users in that org log in
    Then the governance surfaces are hidden only for them
    And their AI-tools (device) CLI login approvals are refused
    And users in other orgs continue with governance enabled unchanged

  Scenario: CLI surface is always available once installed
    Given a user has installed the unified `langwatch` CLI
    When they run `langwatch --help`
    Then every command — governance and otherwise — is listed unconditionally
    And no environment variable is required to expose any subcommand
    And per-account governance entitlement is enforced server-side on the
      underlying APIs the CLI calls

  Scenario: Backend endpoints stay reachable regardless of UI gate
    Given `release_ui_ai_governance_enabled` is false for the user
    When the gateway dispatches a request that requires GatewayBudget,
      RoutingPolicy, or PersonalVirtualKey lookups
    Then those server-side paths execute as normal
    And only the user-visible UI is hidden — backend keeps working

  Scenario: Gating contract documented for downstream contributors
    Given a contributor is adding a new governance UI page
    When they read `dev/docs/adr/038-intent-forked-onboarding-governance-vs-llmops.md`
      and the flag's entry in `langwatch/src/server/featureFlag/registry.ts`
    Then they explain:
      | concern                                                        |
      | which flag to use (release_ui_ai_governance_enabled, not gateway) |
      | how to gate a page (useFeatureFlag hook + redirect/empty state) |
      | how to gate a nav entry (conditional render + a11y considerations) |
      | how to test gating in BDD + integration tests                   |

  Scenario: The cross-org flag check rejects arbitrary organization ids
    Given a user logged into LangWatch who is a member of org A only
    When the workspace switcher asks whether `release_ui_ai_governance_enabled`
      is enabled for any of [org A, org B] (org B is foreign)
    Then the procedure intersects the input with the user's actual
      OrganizationUser memberships before evaluating the flag
    And the flag is evaluated only against org A
    And org B is silently dropped, never passed to the flag service
    And a user with zero matching memberships gets exactly the same
      `{ enabled: false }` response shape as a member whose flag is off,
      so the response cannot be used as a membership oracle
