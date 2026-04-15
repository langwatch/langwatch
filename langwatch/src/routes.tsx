import { Suspense, useEffect } from "react";
import {
  createBrowserRouter,
  Outlet,
  useNavigation,
  type RouteObject,
} from "react-router";
import NProgress from "nprogress";
import { InnerProviders } from "./AppProviders";

/**
 * Root layout — wraps all routes.
 * - InnerProviders: CommandBar, Analytics, PostHog (need Router context)
 * - NProgress: loading bar on navigation (starts when lazy route begins loading)
 */
function RootLayout() {
  const navigation = useNavigation();

  useEffect(() => {
    NProgress.configure({ showSpinner: false });
  }, []);

  useEffect(() => {
    if (navigation.state === "loading") {
      NProgress.start();
    } else {
      NProgress.done();
    }
  }, [navigation.state]);

  return (
    <InnerProviders>
      <Suspense>
        <Outlet />
      </Suspense>
    </InnerProviders>
  );
}

/**
 * Helper: wraps a dynamic import() into the shape React Router's `lazy` expects.
 * React Router's lazy keeps the OLD route visible while the new module loads,
 * eliminating the gray flash that React.lazy + Suspense causes.
 */
// Minimum gap between self-triggered reloads. Short enough that a second
// deploy mid-session still reloads; long enough to avoid a loop if the server
// is genuinely returning broken chunks.
const CHUNK_RELOAD_COOLDOWN_MS = 10_000;

const page = (importFn: () => Promise<{ default: React.ComponentType }>) => ({
  lazy: () =>
    importFn().then((m) => ({ Component: m.default })).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message.toLowerCase() : "";
      const isChunkError =
        msg.includes("loading chunk") ||
        msg.includes("dynamically imported module") ||
        msg.includes("importing a module script failed");

      if (!isChunkError) throw err;

      const lastReloadAt = Number(
        sessionStorage.getItem("chunk-reload-at") ?? "0"
      );
      if (Date.now() - lastReloadAt > CHUNK_RELOAD_COOLDOWN_MS) {
        sessionStorage.setItem("chunk-reload-at", String(Date.now()));
        window.location.reload();
      }
      throw err;
    }),
});

const routes: RouteObject[] = [
  // Auth (public)
  { path: "/auth/signin", ...page(() => import("./pages/auth/signin")) },
  { path: "/auth/signup", ...page(() => import("./pages/auth/signup")) },
  { path: "/auth/error", ...page(() => import("./pages/auth/error")) },

  // Top-level pages
  { path: "/", ...page(() => import("./pages/index")) },
  { path: "/authorize", ...page(() => import("./pages/authorize")) },
  { path: "/admin/*", ...page(() => import("./pages/admin/index")) },
  { path: "/invite/accept", ...page(() => import("./pages/invite/accept")) },
  { path: "/mcp/authorize", ...page(() => import("./pages/mcp/authorize")) },
  { path: "/share/:id", ...page(() => import("./pages/share/[id]")) },

  // Onboarding
  { path: "/onboarding", ...page(() => import("./pages/onboarding")) },
  {
    path: "/onboarding/:team/project",
    ...page(() => import("./pages/onboarding/[team]/project")),
  },
  {
    path: "/onboarding/product",
    ...page(() => import("./pages/onboarding/product/index")),
  },
  {
    path: "/onboarding/welcome",
    ...page(() => import("./pages/onboarding/welcome")),
  },

  // Settings
  { path: "/settings", ...page(() => import("./pages/settings")) },
  {
    path: "/settings/access-audit",
    ...page(() => import("./pages/settings/access-audit")),
  },
  {
    path: "/settings/annotation-scores",
    ...page(() => import("./pages/settings/annotation-scores")),
  },
  {
    path: "/settings/audit-log",
    ...page(() => import("./pages/settings/audit-log")),
  },
  {
    path: "/settings/authentication",
    ...page(() => import("./pages/settings/authentication")),
  },
  {
    path: "/settings/groups",
    ...page(() => import("./pages/settings/groups")),
  },
  {
    path: "/settings/license",
    ...page(() => import("./pages/settings/license")),
  },
  {
    path: "/settings/members",
    ...page(() => import("./pages/settings/members")),
  },
  {
    path: "/settings/model-costs",
    ...page(() => import("./pages/settings/model-costs")),
  },
  {
    path: "/settings/model-providers",
    ...page(() => import("./pages/settings/model-providers")),
  },
  {
    path: "/settings/plans",
    ...page(() => import("./pages/settings/plans")),
  },
  {
    path: "/settings/roles",
    ...page(() => import("./pages/settings/roles")),
  },
  {
    path: "/settings/personal-access-tokens",
    ...page(() => import("./pages/settings/personal-access-tokens")),
  },
  { path: "/settings/scim", ...page(() => import("./pages/settings/scim")) },
  {
    path: "/settings/secrets",
    ...page(() => import("./pages/settings/secrets")),
  },
  {
    path: "/settings/subscription",
    ...page(() => import("./pages/settings/subscription")),
  },
  {
    path: "/settings/teams",
    ...page(() => import("./pages/settings/teams")),
  },
  {
    path: "/settings/teams/:team",
    ...page(() => import("./pages/settings/teams/[team]")),
  },
  {
    path: "/settings/topic-clustering",
    ...page(() => import("./pages/settings/topic-clustering")),
  },
  {
    path: "/settings/usage",
    ...page(() => import("./pages/settings/usage")),
  },

  // Project routes
  {
    path: "/:project",
    ...page(() => import("./pages/[project]/index")),
  },
  {
    path: "/:project/agents",
    ...page(() => import("./pages/[project]/agents")),
  },
  {
    path: "/:project/automations",
    ...page(() => import("./pages/[project]/automations")),
  },
  {
    path: "/:project/datasets",
    ...page(() => import("./pages/[project]/datasets")),
  },
  {
    path: "/:project/datasets/:id",
    ...page(() => import("./pages/[project]/datasets/[id]")),
  },
  {
    path: "/:project/evaluators",
    ...page(() => import("./pages/[project]/evaluators")),
  },
  {
    path: "/:project/evaluations",
    ...page(() => import("./pages/[project]/evaluations")),
  },
  {
    path: "/:project/evaluations/new",
    ...page(() => import("./pages/[project]/evaluations/new")),
  },
  {
    path: "/:project/evaluations/new/choose",
    ...page(() => import("./pages/[project]/evaluations/new/choose")),
  },
  {
    path: "/:project/evaluations/wizard",
    ...page(() => import("./pages/[project]/evaluations/wizard")),
  },
  {
    path: "/:project/evaluations/wizard/:slug",
    ...page(() => import("./pages/[project]/evaluations/wizard/[slug]")),
  },
  {
    path: "/:project/evaluations/:id/edit",
    ...page(() => import("./pages/[project]/evaluations/[id]/edit")),
  },
  {
    path: "/:project/evaluations/:id/edit/choose",
    ...page(() => import("./pages/[project]/evaluations/[id]/edit/choose")),
  },
  {
    path: "/:project/messages",
    ...page(() => import("./pages/[project]/messages")),
  },
  {
    path: "/:project/messages/:trace",
    ...page(() => import("./pages/[project]/messages/[trace]/index")),
  },
  {
    path: "/:project/messages/:trace/:openTab",
    ...page(
      () => import("./pages/[project]/messages/[trace]/[openTab]/index")
    ),
  },
  {
    path: "/:project/messages/:trace/:openTab/:span",
    ...page(
      () => import("./pages/[project]/messages/[trace]/[openTab]/[span]")
    ),
  },
  {
    path: "/:project/prompts",
    ...page(() => import("./pages/[project]/prompts")),
  },
  {
    path: "/:project/setup",
    ...page(() => import("./pages/[project]/setup")),
  },
  {
    path: "/:project/workflows",
    ...page(() => import("./pages/[project]/workflows")),
  },
  {
    path: "/:project/chat/:workflow",
    ...page(() => import("./pages/[project]/chat/[workflow]")),
  },
  {
    path: "/:project/studio/:workflow",
    ...page(() => import("./pages/[project]/studio/[workflow]")),
  },

  // Annotations
  {
    path: "/:project/annotations",
    ...page(() => import("./pages/[project]/annotations")),
  },
  {
    path: "/:project/annotations/all",
    ...page(() => import("./pages/[project]/annotations/all")),
  },
  {
    path: "/:project/annotations/me",
    ...page(() => import("./pages/[project]/annotations/me")),
  },
  {
    path: "/:project/annotations/my-queue",
    ...page(() => import("./pages/[project]/annotations/my-queue")),
  },
  {
    path: "/:project/annotations/:slug",
    ...page(() => import("./pages/[project]/annotations/[slug]")),
  },

  // Analytics
  {
    path: "/:project/analytics",
    ...page(() => import("./pages/[project]/analytics/index")),
  },
  {
    path: "/:project/analytics/evaluations",
    ...page(() => import("./pages/[project]/analytics/evaluations")),
  },
  {
    path: "/:project/analytics/metrics",
    ...page(() => import("./pages/[project]/analytics/metrics")),
  },
  {
    path: "/:project/analytics/reports",
    ...page(() => import("./pages/[project]/analytics/reports")),
  },
  {
    path: "/:project/analytics/topics",
    ...page(() => import("./pages/[project]/analytics/topics")),
  },
  {
    path: "/:project/analytics/users",
    ...page(() => import("./pages/[project]/analytics/users")),
  },
  {
    path: "/:project/analytics/custom",
    ...page(() => import("./pages/[project]/analytics/custom/index")),
  },
  {
    path: "/:project/analytics/custom/:id",
    ...page(() => import("./pages/[project]/analytics/custom/[id]")),
  },

  // Experiments
  {
    path: "/:project/experiments",
    ...page(() => import("./pages/[project]/experiments/index")),
  },
  {
    path: "/:project/experiments/workbench",
    ...page(() => import("./pages/[project]/experiments/workbench/index")),
  },
  {
    path: "/:project/experiments/workbench/:slug",
    ...page(() => import("./pages/[project]/experiments/workbench/[slug]")),
  },
  {
    path: "/:project/experiments/:experiment",
    ...page(() => import("./pages/[project]/experiments/[experiment]")),
  },

  // Simulations (catch-all)
  {
    path: "/:project/simulations/scenarios",
    ...page(() => import("./pages/[project]/simulations/scenarios/index")),
  },
  {
    path: "/:project/simulations/*",
    ...page(() => import("./pages/[project]/simulations/[[...path]]")),
  },
  {
    path: "/:project/simulations",
    ...page(() => import("./pages/[project]/simulations/[[...path]]")),
  },

  // Ops
  { path: "/ops", ...page(() => import("./pages/ops/index")) },
  { path: "/ops/queues", ...page(() => import("./pages/ops/queues")) },
  { path: "/ops/dejaview", ...page(() => import("./pages/ops/dejaview")) },
  { path: "/ops/foundry", ...page(() => import("./pages/ops/foundry")) },
  {
    path: "/ops/projections",
    ...page(() => import("./pages/ops/projections")),
  },
  {
    path: "/ops/projections/:runId",
    ...page(() => import("./pages/ops/projections/[runId]")),
  },
  {
    path: "/ops/backoffice",
    ...page(() => import("./pages/ops/backoffice")),
  },
  {
    path: "/ops/backoffice/users",
    ...page(() => import("./pages/ops/backoffice/users")),
  },
  {
    path: "/ops/backoffice/organizations",
    ...page(() => import("./pages/ops/backoffice/organizations")),
  },
  {
    path: "/ops/backoffice/projects",
    ...page(() => import("./pages/ops/backoffice/projects")),
  },
  {
    path: "/ops/backoffice/subscriptions",
    ...page(() => import("./pages/ops/backoffice/subscriptions")),
  },
  {
    path: "/ops/backoffice/organization-features",
    ...page(() => import("./pages/ops/backoffice/organization-features")),
  },

  // @project redirect — Next.js parallel route that redirects /@project/path to /:project/path
  {
    path: "/@project/*",
    ...page(() => import("./pages/@project/[...path]/index")),
  },
];

export const router = createBrowserRouter([
  {
    Component: RootLayout,
    children: routes,
  },
]);
