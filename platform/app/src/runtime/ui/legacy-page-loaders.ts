/**
 * Where every routed page still lives.
 *
 * `@langwatch/ui` owns the route table — the paths, their nesting and their
 * page keys — and this is the other half of that seam: the key-to-module
 * install list the browser composition hands it. The pages themselves have not
 * moved out of this application yet, so each key resolves to a lazy import of
 * the module that has always served it.
 *
 * As a page migrates into a feature-web `screens/` entry, only its line here
 * changes. The route table, the URL and the loader key stay exactly as they
 * are, which is what keeps the move invisible to a bookmark.
 *
 * `legacy-page-loaders.unit.test.ts` pins this registry to the table: every
 * key the table names is registered, and nothing is registered that the table
 * does not name.
 */

import type { UiPageLoaderRegistry } from "@langwatch/ui";

export const legacyPageLoaders: UiPageLoaderRegistry = {
  "pages/auth/signin": () => import("~/pages/auth/signin"),
  "pages/auth/signup": () => import("~/pages/auth/signup"),
  "pages/auth/forgot-password": () => import("~/pages/auth/forgot-password"),
  "pages/auth/reset-password": () => import("~/pages/auth/reset-password"),
  "pages/auth/verify-email": () => import("~/pages/auth/verify-email"),
  "pages/auth/error": () => import("~/pages/auth/error"),
  "pages/auth/join": () => import("~/pages/auth/join"),
  "pages/index": () => import("~/pages/index"),
  "pages/authorize": () => import("~/pages/authorize"),
  "pages/admin/index": () => import("~/pages/admin/index"),
  "pages/invite/accept": () => import("~/pages/invite/accept"),
  "pages/mcp/authorize": () => import("~/pages/mcp/authorize"),
  "pages/share/[id]": () => import("~/pages/share/[id]"),
  "pages/unsubscribe": () => import("~/pages/unsubscribe"),
  "pages/onboarding": () => import("~/pages/onboarding"),
  "pages/onboarding/[team]/project": () => import("~/pages/onboarding/[team]/project"),
  "pages/onboarding/product/index": () => import("~/pages/onboarding/product/index"),
  "pages/onboarding/welcome": () => import("~/pages/onboarding/welcome"),
  "features/langy/ProjectLangyLayout": () => import("~/features/langy/ProjectLangyLayout"),
  "pages/settings": () => import("~/pages/settings"),
  "pages/settings/role-bindings": () => import("~/pages/settings/role-bindings"),
  "pages/settings/annotation-scores": () => import("~/pages/settings/annotation-scores"),
  "pages/settings/data-retention": () => import("~/pages/settings/data-retention"),
  "pages/settings/integrations": () => import("~/pages/settings/integrations"),
  "pages/settings/data-privacy": () => import("~/pages/settings/data-privacy"),
  "pages/settings/audit-log": () => import("~/pages/settings/audit-log"),
  "pages/settings/authentication": () => import("~/pages/settings/authentication"),
  "pages/settings/groups": () => import("~/pages/settings/groups"),
  "pages/settings/license": () => import("~/pages/settings/license"),
  "pages/settings/members": () => import("~/pages/settings/members"),
  "pages/settings/model-costs": () => import("~/pages/settings/model-costs"),
  "pages/settings/model-providers": () => import("~/pages/settings/model-providers"),
  "pages/settings/plans": () => import("~/pages/settings/plans"),
  "pages/settings/roles": () => import("~/pages/settings/roles"),
  "pages/settings/api-keys": () => import("~/pages/settings/api-keys"),
  "pages/settings/scim": () => import("~/pages/settings/scim"),
  "pages/settings/secrets": () => import("~/pages/settings/secrets"),
  "pages/settings/subscription": () => import("~/pages/settings/subscription"),
  "pages/settings/teams": () => import("~/pages/settings/teams"),
  "pages/settings/teams/[team]": () => import("~/pages/settings/teams/[team]"),
  "pages/settings/topic-clustering": () => import("~/pages/settings/topic-clustering"),
  "pages/settings/usage": () => import("~/pages/settings/usage"),
  "pages/settings/email-suppressions": () => import("~/pages/settings/email-suppressions"),
  "pages/governance/index": () => import("~/pages/governance/index"),
  "pages/governance/inventory.enterprise": () => import("~/pages/governance/inventory.enterprise"),
  "pages/governance/ingestion-source-detail.enterprise": () =>
    import("~/pages/governance/ingestion-source-detail.enterprise"),
  "pages/governance/anomaly-rules.enterprise": () =>
    import("~/pages/governance/anomaly-rules.enterprise"),
  "pages/governance/people": () => import("~/pages/governance/people"),
  "pages/governance/costs": () => import("~/pages/governance/costs"),
  "pages/governance/billed": () => import("~/pages/governance/billed"),
  "pages/governance/teams": () => import("~/pages/governance/teams"),
  "pages/governance/teams/[id]": () => import("~/pages/governance/teams/[id]"),
  "pages/governance/users": () => import("~/pages/governance/users"),
  "pages/governance/users/[id]": () => import("~/pages/governance/users/[id]"),
  "pages/me/index": () => import("~/pages/me/index"),
  "pages/me/configure": () => import("~/pages/me/configure"),
  "pages/me/devices": () => import("~/pages/me/devices"),
  "pages/me/pull-requests": () => import("~/pages/me/pull-requests"),
  "pages/me/sessions": () => import("~/pages/me/sessions"),
  "pages/me/budget/request": () => import("~/pages/me/budget/request"),
  "pages/cli/auth": () => import("~/pages/cli/auth"),
  "pages/gateway/index": () => import("~/pages/gateway/index"),
  "pages/gateway/virtual-keys": () => import("~/pages/gateway/virtual-keys"),
  "pages/gateway/virtual-keys/[id]": () => import("~/pages/gateway/virtual-keys/[id]"),
  "pages/gateway/budgets": () => import("~/pages/gateway/budgets"),
  "pages/gateway/budgets/[id]": () => import("~/pages/gateway/budgets/[id]"),
  "pages/gateway/routing-policies": () => import("~/pages/gateway/routing-policies"),
  "pages/gateway/usage": () => import("~/pages/gateway/usage"),
  "pages/gateway/cache-rules": () => import("~/pages/gateway/cache-rules"),
  "pages/gateway/guardrails": () => import("~/pages/gateway/guardrails"),
  "pages/gateway/billing-events": () => import("~/pages/gateway/billing-events"),
  "pages/gateway/webhooks": () => import("~/pages/gateway/webhooks"),
  "pages/[project]/index": () => import("~/pages/[project]/index"),
  "runtime/ui/features/agent-ui-host.adapter": () =>
    import("~/runtime/ui/features/agent-ui-host.adapter"),
  "pages/[project]/sessions": () => import("~/pages/[project]/sessions"),
  "pages/[project]/pull-requests": () => import("~/pages/[project]/pull-requests"),
  "pages/[project]/automations": () => import("~/pages/[project]/automations"),
  "pages/[project]/automations/automations": () =>
    import("~/pages/[project]/automations/automations"),
  "pages/[project]/automations/alerts": () => import("~/pages/[project]/automations/alerts"),
  "pages/[project]/automations/schedules": () => import("~/pages/[project]/automations/schedules"),
  "pages/[project]/automations/activity": () => import("~/pages/[project]/automations/activity"),
  "pages/[project]/datasets": () => import("~/pages/[project]/datasets"),
  "pages/[project]/datasets/[id]": () => import("~/pages/[project]/datasets/[id]"),
  "pages/[project]/evaluators": () => import("~/pages/[project]/evaluators"),
  "pages/[project]/evaluations": () => import("~/pages/[project]/evaluations"),
  "pages/[project]/online-evaluations": () => import("~/pages/[project]/online-evaluations"),
  "pages/[project]/evaluations/new": () => import("~/pages/[project]/evaluations/new"),
  "pages/[project]/evaluations/new/choose": () =>
    import("~/pages/[project]/evaluations/new/choose"),
  "pages/[project]/evaluations/wizard": () => import("~/pages/[project]/evaluations/wizard"),
  "pages/[project]/evaluations/wizard/[slug]": () =>
    import("~/pages/[project]/evaluations/wizard/[slug]"),
  "pages/[project]/evaluations/[id]/edit": () => import("~/pages/[project]/evaluations/[id]/edit"),
  "pages/[project]/evaluations/[id]/edit/choose": () =>
    import("~/pages/[project]/evaluations/[id]/edit/choose"),
  "pages/[project]/traces": () => import("~/pages/[project]/traces"),
  "pages/[project]/traces/[trace]": () => import("~/pages/[project]/traces/[trace]"),
  "pages/[project]/messages/index": () => import("~/pages/[project]/messages/index"),
  "pages/[project]/messages/[trace]/index": () =>
    import("~/pages/[project]/messages/[trace]/index"),
  "pages/[project]/messages/[trace]/[openTab]/index": () =>
    import("~/pages/[project]/messages/[trace]/[openTab]/index"),
  "pages/[project]/messages/[trace]/[openTab]/[span]": () =>
    import("~/pages/[project]/messages/[trace]/[openTab]/[span]"),
  "pages/[project]/prompts": () => import("~/pages/[project]/prompts"),
  "pages/[project]/setup": () => import("~/pages/[project]/setup"),
  "pages/[project]/workflows": () => import("~/pages/[project]/workflows"),
  "pages/[project]/chat/[workflow]": () => import("~/pages/[project]/chat/[workflow]"),
  "pages/[project]/studio/[workflow]": () => import("~/pages/[project]/studio/[workflow]"),
  "pages/[project]/annotations": () => import("~/pages/[project]/annotations"),
  "pages/[project]/annotations/all": () => import("~/pages/[project]/annotations/all"),
  "pages/[project]/annotations/me": () => import("~/pages/[project]/annotations/me"),
  "pages/[project]/annotations/my-queue": () => import("~/pages/[project]/annotations/my-queue"),
  "pages/[project]/annotations/[slug]": () => import("~/pages/[project]/annotations/[slug]"),
  "pages/[project]/analytics/index": () => import("~/pages/[project]/analytics/index"),
  "pages/[project]/analytics/evaluations": () => import("~/pages/[project]/analytics/evaluations"),
  "pages/[project]/analytics/metrics": () => import("~/pages/[project]/analytics/metrics"),
  "pages/[project]/analytics/reports": () => import("~/pages/[project]/analytics/reports"),
  "pages/[project]/analytics/topics": () => import("~/pages/[project]/analytics/topics"),
  "pages/[project]/analytics/users": () => import("~/pages/[project]/analytics/users"),
  "pages/[project]/analytics/query": () => import("~/pages/[project]/analytics/query"),
  "pages/[project]/analytics/custom/index": () =>
    import("~/pages/[project]/analytics/custom/index"),
  "pages/[project]/analytics/custom/[id]": () => import("~/pages/[project]/analytics/custom/[id]"),
  "pages/[project]/experiments/index": () => import("~/pages/[project]/experiments/index"),
  "pages/[project]/experiments/workbench/index": () =>
    import("~/pages/[project]/experiments/workbench/index"),
  "pages/[project]/experiments/workbench/[slug]": () =>
    import("~/pages/[project]/experiments/workbench/[slug]"),
  "pages/[project]/experiments/[experiment]": () =>
    import("~/pages/[project]/experiments/[experiment]"),
  "pages/[project]/agent-testing/[[...path]]": () =>
    import("~/pages/[project]/agent-testing/[[...path]]"),
  "pages/[project]/simulations/scenarios/index": () =>
    import("~/pages/[project]/simulations/scenarios/index"),
  "pages/[project]/simulations/[[...path]]": () =>
    import("~/pages/[project]/simulations/[[...path]]"),
  "pages/ops/index": () => import("~/pages/ops/index"),
  "pages/ops/queues": () => import("~/pages/ops/queues"),
  "pages/ops/dejaview": () => import("~/pages/ops/dejaview"),
  "pages/ops/scheduler": () => import("~/pages/ops/scheduler"),
  "pages/ops/event-sourcing/index": () => import("~/pages/ops/event-sourcing/index"),
  "pages/ops/event-sourcing/dead-letters": () => import("~/pages/ops/event-sourcing/dead-letters"),
  "pages/ops/event-sourcing/processes": () => import("~/pages/ops/event-sourcing/processes"),
  "pages/ops/event-sourcing/projections": () => import("~/pages/ops/event-sourcing/projections"),
  "pages/ops/event-sourcing/subscribers": () => import("~/pages/ops/event-sourcing/subscribers"),
  "pages/ops/event-sourcing/schedules": () => import("~/pages/ops/event-sourcing/schedules"),
  "pages/ops/blobs": () => import("~/pages/ops/blobs"),
  "pages/ops/feature-flags": () => import("~/pages/ops/feature-flags"),
  "pages/ops/foundry": () => import("~/pages/ops/foundry"),
  "pages/ops/migrations": () => import("~/pages/ops/migrations"),
  "pages/ops/projections": () => import("~/pages/ops/projections"),
  "pages/ops/projections/[runId]": () => import("~/pages/ops/projections/[runId]"),
  "pages/ops/backoffice": () => import("~/pages/ops/backoffice"),
  "pages/ops/backoffice/bug-reports": () => import("~/pages/ops/backoffice/bug-reports"),
  "pages/ops/backoffice/users": () => import("~/pages/ops/backoffice/users"),
  "pages/ops/backoffice/organizations": () => import("~/pages/ops/backoffice/organizations"),
  "pages/ops/backoffice/projects": () => import("~/pages/ops/backoffice/projects"),
  "pages/ops/backoffice/subscriptions": () => import("~/pages/ops/backoffice/subscriptions"),
  "pages/ops/backoffice/sso-connections": () => import("~/pages/ops/backoffice/sso-connections"),
  "pages/@project/[...path]/index": () => import("~/pages/@project/[...path]/index"),
  "pages/not-found": () => import("~/pages/not-found"),
};
