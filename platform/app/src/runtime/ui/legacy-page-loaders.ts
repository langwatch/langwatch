/**
 * Where every routed page still lives.
 *
 * `@langwatch/ui` owns the route table — the paths, their nesting and their
 * page keys — and this is the other half of that seam: the key-to-module
 * install list the browser composition hands it. The pages themselves have not
 * moved out of this application yet, so each key resolves to a lazy import of
 * the module that has always served it.
 *
 * Several addresses share one screen. Where they do, every key names the
 * shared module — the file that used to sit at the extra address and re-export
 * it is gone — and a key whose address is served by a named export rather than
 * the default names that export. Which component each of those keys resolves
 * is pinned in `legacy-page-loaders.unit.test.ts`.
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
  "pages/settings/annotation-scores": () => import("~/pages/settings/annotation-scores"),
  "pages/settings/integrations": () => import("~/pages/settings/integrations"),
  "pages/settings/audit-log": () => import("~/pages/settings/audit-log"),
  "pages/settings/authentication": () => import("~/pages/settings/authentication"),
  "pages/settings/groups": () => import("~/pages/settings/groups"),
  "pages/settings/license": () => import("~/pages/settings/license"),
  "pages/settings/members": () => import("~/pages/settings/members"),
  "pages/settings/plans": () => import("~/pages/settings/plans"),
  "pages/settings/api-keys": () => import("~/pages/settings/api-keys"),
  "pages/settings/scim": () => import("~/pages/settings/scim"),
  "pages/settings/secrets": () => import("~/pages/settings/secrets"),
  "pages/settings/subscription": () => import("~/pages/settings/subscription"),
  "pages/settings/teams": () => import("~/pages/settings/teams"),
  "pages/settings/teams/[team]": () => import("~/pages/settings/teams/[team]"),
  "pages/settings/topic-clustering": () => import("~/pages/settings/topic-clustering"),
  "pages/settings/usage": () => import("~/pages/settings/usage"),
  "pages/settings/email-suppressions": () => import("~/pages/settings/email-suppressions"),
  "pages/cli/auth": () => import("~/pages/cli/auth"),
  "pages/[project]/index": () => import("~/pages/[project]/index"),
  "pages/[project]/evaluators": () => import("~/pages/[project]/evaluators"),
  "pages/[project]/online-evaluations": () => import("~/pages/[project]/online-evaluations"),
  "pages/[project]/evaluations/wizard": () => import("~/pages/[project]/evaluations/wizard"),
  "pages/[project]/evaluations/wizard/[slug]": () => import("~/pages/[project]/evaluations/wizard"),
  "pages/[project]/evaluations/[id]/edit": () => import("~/pages/[project]/evaluations/[id]/edit"),
  "pages/[project]/evaluations/[id]/edit/choose": () =>
    import("~/pages/[project]/evaluations/[id]/edit"),
  "pages/[project]/traces": () => import("~/pages/[project]/traces"),
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
  // /experiments and /evaluations are one module: the experiments address
  // serves its guarded named export, the evaluations address its default.
  // The alias file that re-exported the one as the other is gone, so the key
  // names the export itself.
  "pages/[project]/experiments/index": () =>
    import("~/pages/[project]/evaluations").then((module) => ({
      default: module.GuardedExperimentsPage,
    })),
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
  "pages/@project/[...path]/index": () => import("~/pages/@project/[...path]/index"),
  "pages/not-found": () => import("~/pages/not-found"),
};
