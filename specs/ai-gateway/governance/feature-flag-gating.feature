Feature: Governance preview hides behind a single feature flag and CLI env var
  The governance plane (personal keys, admin oversight, RoutingPolicy
  admin, IngestionSource setup, Activity Monitor, the unified `langwatch`
  CLI's preview commands) is being built out on a long-lived branch
  while existing customers continue using the shipping product. To let
  this branch merge into main without exposing in-progress surfaces, all
  user-visible governance UI is gated behind ONE app feature flag and
  all governance CLI commands are gated behind ONE env var. Both default
  off.

  Spec scope: the gating contract itself — what's hidden, when, and how
  to enable it for development. Implementation lives in
  `langwatch/src/server/featureFlag/frontendFeatureFlags.ts` and
  `typescript-sdk/src/cli/utils/governance/preview-flag.ts`.

  Background:
    Given the canonical names are locked:
      | surface | name                                 |
      | App     | release_ui_ai_governance_enabled     |
      | CLI     | LANGWATCH_GOVERNANCE_PREVIEW         |
    And the AI Gateway product itself ships unblocked on its own flag
      `release_ui_ai_gateway_menu_enabled` (separate concern, not gated)

  Scenario: The single app flag gates every new governance UI surface
    Given a user logged into LangWatch
    And `release_ui_ai_governance_enabled` evaluates to false for them
    When they navigate the product
    Then none of the governance preview surfaces are reachable from the UI:
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

  Scenario: Force-enable in dev via env override
    Given a developer is running `pnpm dev`
    When they set `FEATURE_FLAG_FORCE_ENABLE=release_ui_ai_governance_enabled`
    Then every governance surface above renders
    And the standard PostHog evaluation path is bypassed
    And no PostHog connection is required for the override to work

  Scenario: Per-org rollout via PostHog release condition
    Given an admin enables the governance preview for one customer org via PostHog
    When users in that org log in
    Then the governance surfaces render only for them
    And users in other orgs continue to see the existing product unchanged

  Scenario: CLI env var gates the preview subcommands
    Given a user has installed the unified `langwatch` CLI
    And `LANGWATCH_GOVERNANCE_PREVIEW` is unset
    When they run `langwatch --help`
    Then the governance preview subcommands are not listed:
      | subcommand        |
      | login --device    |
      | whoami            |
      | me                |
      | claude            |
      | codex             |
      | cursor            |
      | gemini            |
      | request-increase  |
      | logout-device     |
      | init-shell        |
    And the existing CLI surface (login --api-key, dataset, sync, prompts, scenarios) is unchanged
    And invoking a governance subcommand by name returns a clear error pointing at the env var
    And the error exits with status 2 (config error)

  Scenario: CLI env var ON exposes the preview subcommands
    Given `LANGWATCH_GOVERNANCE_PREVIEW=1` is set
    When the user runs `langwatch --help`
    Then all 10 governance preview subcommands are listed
    And each subcommand executes its full behaviour
    And the env var is read at process start (not per-invocation)

  Scenario: Backend endpoints stay reachable regardless of UI gate
    Given `release_ui_ai_governance_enabled` is false for the user
    When the gateway dispatches a request that requires GatewayBudget,
      RoutingPolicy, or PersonalVirtualKey lookups
    Then those server-side paths execute as normal
    And only the user-visible UI is hidden — backend keeps working
    And this matches @rchaves's directive: "do not worry about the backend,
      just hiding from the frontend is enough"

  Scenario: Gating contract documented for downstream contributors
    Given a contributor is adding a new governance UI page
    When they read docs/ai-gateway/governance/feature-flag.md
    Then it explains:
      | concern                                                        |
      | which flag to use (release_ui_ai_governance_enabled, not gateway) |
      | how to gate a page (useFeatureFlag hook + redirect/empty state) |
      | how to gate a nav entry (conditional render + a11y considerations) |
      | how to test gating in BDD + integration tests                   |
      | how the CLI env var maps to the same product line                |
