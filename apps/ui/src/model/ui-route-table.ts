/**
 * The application's URL surface, as data.
 *
 * Every path, its nesting under a layout route and every retired prefix that
 * still has to land somewhere live here, in one ordered table. A page itself
 * is named, not imported: the entry carries the module KEY its loader is
 * registered under, and the composing application supplies the loader for that
 * key. That is what lets a page move into a feature-web `screens/` entry one
 * at a time — the loader for its key repoints and this table does not change.
 *
 * The table is data, so it holds no element, no lazy import and no component.
 * `ui/sections/ui-route-objects` turns it into React Router route objects, and
 * `behavior/ui-router` builds the router around them.
 */

export type UiRedirectDescriptor = {
  readonly from: string;
  readonly to: string;
  /**
   * Query params forced onto the destination, overriding whatever the old
   * address carried under those keys. See `UiPrefixRedirect`, which is what
   * renders this.
   */
  readonly pinParams?: Readonly<Record<string, string>>;
};

/** A route that renders a page, or a pathless layout route that wraps others. */
export type UiPageRouteDescriptor = {
  readonly path?: string;
  /** The key the composing application registers this page's loader under. */
  readonly page: string;
  readonly children?: readonly UiRouteDescriptor[];
};

/** A retired address that forwards to its new home. */
export type UiRedirectRouteDescriptor = {
  readonly path: string;
  readonly redirect: UiRedirectDescriptor;
};

export type UiRouteDescriptor = UiPageRouteDescriptor | UiRedirectRouteDescriptor;

/**
 * Every descriptor in a table, flattened into match order.
 *
 * Nesting only joins a layout to the pages it wraps; every path in the table
 * is absolute, so a flat list ranks the same way the router does. Callers that
 * need to ask what the application routes read this rather than the file.
 */
export function uiRouteDescriptors(table: readonly UiRouteDescriptor[]): UiRouteDescriptor[] {
  return table.flatMap((descriptor) =>
    "redirect" in descriptor
      ? [descriptor]
      : [descriptor, ...uiRouteDescriptors(descriptor.children ?? [])],
  );
}

/**
 * Prefixes that moved to a new top-level home. Old links, bookmarks, emails
 * and stored pins keep landing: the whole prefix forwards with sub-path,
 * query and hash intact, and the history entry is replaced. Named separately
 * from the table it is spread into so the redirect tests exercise the same
 * descriptors the application mounts.
 *
 * Spec: specs/navigation/gateway-url-move.feature and
 * specs/ai-gateway/governance/governance-home-routing.feature (the retired
 * ingestion-sources prefix).
 */
export const uiLegacyRedirectRoutes: readonly UiRedirectRouteDescriptor[] = [
  // The sources surface has had three addresses: ingestion-sources →
  // catalog (PR-renamed) → the inventory Sources tab. Every retired
  // address maps STRAIGHT to its final home — no chaining through the
  // also-retired middle name. The bare forms pin ?tab=sources, overriding
  // any tab the old address carried: they served one pane, so every value
  // they ever took rendered the sources list, while the inventory default
  // is Catalog. The deep-link forms go to the detail page, which has no
  // tabs.
  {
    path: "/governance/ingestion-sources/*",
    redirect: { from: "/governance/ingestion-sources", to: "/governance/inventory" },
  },
  {
    path: "/governance/ingestion-sources",
    redirect: {
      from: "/governance/ingestion-sources",
      to: "/governance/inventory",
      pinParams: { tab: "sources" },
    },
  },
  {
    path: "/governance/catalog/*",
    redirect: { from: "/governance/catalog", to: "/governance/inventory" },
  },
  {
    path: "/governance/catalog",
    redirect: {
      from: "/governance/catalog",
      to: "/governance/inventory",
      pinParams: { tab: "sources" },
    },
  },
  {
    // Bare, no ?tab=: the bare inventory address resolves to the Catalog
    // tab for the aiTools:manage admins this page served, and to Sources
    // for viewers — the pane they can actually read.
    path: "/governance/tool-catalog",
    redirect: { from: "/governance/tool-catalog", to: "/governance/inventory" },
  },
  {
    path: "/governance/departments",
    redirect: { from: "/governance/departments", to: "/governance/people" },
  },
  {
    path: "/settings/gateway/*",
    redirect: { from: "/settings/gateway", to: "/gateway" },
  },
  {
    path: "/settings/gateway",
    redirect: { from: "/settings/gateway", to: "/gateway" },
  },
  {
    path: "/settings/governance/*",
    redirect: { from: "/settings/governance", to: "/governance" },
  },
  {
    path: "/settings/governance",
    redirect: { from: "/settings/governance", to: "/governance" },
  },
  {
    path: "/settings/routing-policies/*",
    redirect: { from: "/settings/routing-policies", to: "/gateway/routing-policies" },
  },
  {
    path: "/settings/routing-policies",
    redirect: { from: "/settings/routing-policies", to: "/gateway/routing-policies" },
  },
];

export const uiRouteTable: readonly UiRouteDescriptor[] = [
  // Auth (public)
  { path: "/auth/signin", page: "pages/auth/signin" },
  { path: "/auth/signup", page: "pages/auth/signup" },
  {
    path: "/auth/forgot-password",
    page: "pages/auth/forgot-password",
  },
  {
    path: "/auth/reset-password",
    page: "pages/auth/reset-password",
  },
  // The email-verification magic link lands here; it renders only (D01).
  {
    path: "/auth/verify-email",
    page: "pages/auth/verify-email",
  },
  { path: "/auth/error", page: "pages/auth/error" },
  // Join before create (ADR-117 §6): a new account passes through here on its
  // way to making an organization. Renders nothing until D12 fills it.
  { path: "/auth/join", page: "pages/auth/join" },

  // Top-level pages
  { path: "/", page: "pages/index" },
  { path: "/authorize", page: "pages/authorize" },
  { path: "/admin/*", page: "pages/admin/index" },
  { path: "/invite/accept", page: "pages/invite/accept" },
  { path: "/mcp/authorize", page: "pages/mcp/authorize" },
  { path: "/share/:id", page: "pages/share/[id]" },
  // Public — no auth required; token in query-string is the authorisation
  { path: "/unsubscribe", page: "pages/unsubscribe" },

  // Onboarding
  { path: "/onboarding", page: "pages/onboarding" },
  {
    path: "/onboarding/:team/project",
    page: "pages/onboarding/[team]/project",
  },
  {
    path: "/onboarding/product",
    page: "pages/onboarding/product/index",
  },
  {
    path: "/onboarding/welcome",
    page: "pages/onboarding/welcome",
  },

  // Settings, wrapped in the same Langy layout as the project routes
  // (keyed by the AMBIENT project), so the panel survives hopping between
  // a project page and settings instead of vanishing.
  {
    page: "features/langy/ProjectLangyLayout",
    children: [
      { path: "/settings", page: "pages/settings" },
      {
        path: "/settings/role-bindings",
        page: "pages/settings/role-bindings",
      },
      {
        path: "/settings/annotation-scores",
        page: "pages/settings/annotation-scores",
      },
      {
        path: "/settings/data-retention",
        page: "pages/settings/data-retention",
      },
      {
        path: "/settings/integrations",
        page: "pages/settings/integrations",
      },
      {
        path: "/settings/data-privacy",
        page: "pages/settings/data-privacy",
      },
      {
        path: "/settings/audit-log",
        page: "pages/settings/audit-log",
      },
      {
        path: "/settings/authentication",
        page: "pages/settings/authentication",
      },
      {
        path: "/settings/groups",
        page: "pages/settings/groups",
      },
      {
        path: "/settings/license",
        page: "pages/settings/license",
      },
      {
        path: "/settings/members",
        page: "pages/settings/members",
      },
      {
        path: "/settings/model-costs",
        page: "pages/settings/model-costs",
      },
      {
        path: "/settings/model-providers",
        page: "pages/settings/model-providers",
      },
      {
        path: "/settings/plans",
        page: "pages/settings/plans",
      },
      {
        path: "/settings/roles",
        page: "pages/settings/roles",
      },
      {
        path: "/settings/api-keys",
        page: "pages/settings/api-keys",
      },
      {
        path: "/settings/scim",
        page: "pages/settings/scim",
      },
      {
        path: "/settings/secrets",
        page: "pages/settings/secrets",
      },
      {
        path: "/settings/subscription",
        page: "pages/settings/subscription",
      },
      {
        path: "/settings/teams",
        page: "pages/settings/teams",
      },
      {
        path: "/settings/teams/:team",
        page: "pages/settings/teams/[team]",
      },
      {
        path: "/settings/topic-clustering",
        page: "pages/settings/topic-clustering",
      },
      {
        path: "/settings/usage",
        page: "pages/settings/usage",
      },
      {
        path: "/settings/email-suppressions",
        page: "pages/settings/email-suppressions",
      },
      {
        // Governance home (admin oversight dashboard). The whole family
        // lives at the top level: it is org-scoped, not a settings page.
        path: "/governance",
        page: "pages/governance/index",
      },
      {
        path: "/governance/inventory",
        page: "pages/governance/inventory.enterprise",
      },
      {
        path: "/governance/inventory/:id",
        page: "pages/governance/ingestion-source-detail.enterprise",
      },
      {
        path: "/governance/anomaly-rules",
        page: "pages/governance/anomaly-rules.enterprise",
      },
      {
        path: "/governance/people",
        page: "pages/governance/people",
      },
      {
        // Behind release_ui_governance_billed_cost_enabled (the pages
        // guard themselves); the nav items are filtered on the same flag.
        path: "/governance/costs",
        page: "pages/governance/costs",
      },
      {
        path: "/governance/billed",
        page: "pages/governance/billed",
      },
      {
        // The people page has been cost centers and then departments; old
        // bookmarks land on the newest name in one hop (the legacy
        // /settings/governance/cost-centers address chains through here,
        // and /governance/departments redirects via legacyRedirectRoutes).
        path: "/governance/cost-centers",
        redirect: { from: "/governance/cost-centers", to: "/governance/people" },
      },
      {
        // View-all teams listing - bird's-eye `View all teams →` lands here.
        // 500-row paginated list with sort chips for spend / requests /
        // last-activity. Per-row click-through routes to the team detail
        // page below.
        path: "/governance/teams",
        page: "pages/governance/teams",
      },
      {
        // Per-team detail - single-row scoped view of `spendByTeam` filtered
        // to the URL-encoded team id, four-stat KPI grid + breadcrumb back
        // to the listing. Detail-data depth (per-day trend, per-user
        // breakdown, model mix) defers to a follow-up.
        path: "/governance/teams/:id",
        page: "pages/governance/teams/[id]",
      },
      {
        // View-all users listing - bird's-eye `View all users →` lands here.
        path: "/governance/users",
        page: "pages/governance/users",
      },
      {
        // Per-user detail - single-row scoped view keyed off the
        // URL-encoded actor id (email / sub claim).
        path: "/governance/users/:id",
        page: "pages/governance/users/[id]",
      },

      // Personal-scope governance routes (must precede the /:project catch-all
      // so "me" doesn't get treated as a project slug)
      {
        path: "/me",
        page: "pages/me/index",
      },
      {
        path: "/me/configure",
        page: "pages/me/configure",
      },
      {
        // The devices inventory moved into a tab of /me/configure, and this
        // path keeps resolving so old links do not dead-end. A page that
        // renders <Navigate>, not a `loader` redirect: loaders do not run on a
        // cold load of the SPA, which is exactly how a stale link arrives.
        path: "/me/devices",
        page: "pages/me/devices",
      },
      {
        path: "/me/pull-requests",
        page: "pages/me/pull-requests",
      },
      {
        path: "/me/sessions",
        page: "pages/me/sessions",
      },
      {
        // Budget-increase request page that the CLI's `langwatch request-increase`
        // opens. The page file existed but routes.tsx is explicit (Vite migration)
        // - without this entry the URL 404'd, breaking the per-spec
        // budget-exceeded → request flow Ariana caught in dogfood.
        path: "/me/budget/request",
        page: "pages/me/budget/request",
      },

      // CLI device-flow approval (RFC 8628 user-facing screen)
      {
        path: "/cli/auth",
        page: "pages/cli/auth",
      },

      // AI Gateway: org-scoped admin pages live under /gateway/** at the top
      // level, like /governance. Every gateway resource (VirtualKey /
      // GatewayBudget / ModelProvider) is org-keyed by the schema, so the
      // chrome reflects that. Kept OUT of the project layout route below:
      // these are not /:project/* routes, so Langy must not mount on them.
      // The static /gateway segment always wins over the /:project catch-all,
      // and project slug minting refuses reserved top-level names.
      {
        path: "/gateway",
        page: "pages/gateway/index",
      },
      {
        path: "/gateway/virtual-keys",
        page: "pages/gateway/virtual-keys",
      },
      {
        path: "/gateway/virtual-keys/:id",
        page: "pages/gateway/virtual-keys/[id]",
      },
      {
        path: "/gateway/budgets",
        page: "pages/gateway/budgets",
      },
      {
        path: "/gateway/budgets/:id",
        page: "pages/gateway/budgets/[id]",
      },
      {
        path: "/gateway/routing-policies",
        page: "pages/gateway/routing-policies",
      },
      {
        path: "/gateway/usage",
        page: "pages/gateway/usage",
      },
      {
        path: "/gateway/cache-rules",
        page: "pages/gateway/cache-rules",
      },
      {
        path: "/gateway/guardrails",
        page: "pages/gateway/guardrails",
      },
      {
        path: "/gateway/billing-events",
        page: "pages/gateway/billing-events",
      },
      {
        path: "/gateway/webhooks",
        page: "pages/gateway/webhooks",
      },
      ...uiLegacyRedirectRoutes,
    ],
  },

  // Project routes — wrapped in a layout route that mounts Langy ONCE per
  // project, above the swapping page, so the panel + composer draft + any
  // in-flight response survive navigation between project pages. The layout
  // component is keyed by :project, so Langy resets on project switch. Loaded
  // lazily via page() so Langy's chat bundle stays out of the initial load.
  // See ProjectLangyLayout + specs/langy/langy-navigation-persistence.feature
  {
    page: "features/langy/ProjectLangyLayout",
    children: [
      {
        path: "/:project",
        page: "pages/[project]/index",
      },
      {
        path: "/:project/agents",
        page: "runtime/ui/features/agent-ui-host.adapter",
      },

      // Coding-agent activity, project scope
      {
        path: "/:project/sessions",
        page: "pages/[project]/sessions",
      },
      {
        path: "/:project/pull-requests",
        page: "pages/[project]/pull-requests",
      },

      {
        path: "/:project/automations",
        page: "pages/[project]/automations",
      },
      {
        path: "/:project/automations/automations",
        page: "pages/[project]/automations/automations",
      },
      {
        path: "/:project/automations/alerts",
        page: "pages/[project]/automations/alerts",
      },
      {
        path: "/:project/automations/schedules",
        page: "pages/[project]/automations/schedules",
      },
      {
        path: "/:project/automations/activity",
        page: "pages/[project]/automations/activity",
      },
      {
        path: "/:project/datasets",
        page: "pages/[project]/datasets",
      },
      {
        path: "/:project/datasets/:id",
        page: "pages/[project]/datasets/[id]",
      },
      {
        path: "/:project/evaluators",
        page: "pages/[project]/evaluators",
      },
      {
        path: "/:project/evaluations",
        page: "pages/[project]/evaluations",
      },
      {
        path: "/:project/online-evaluations",
        page: "pages/[project]/online-evaluations",
      },
      {
        path: "/:project/evaluations/new",
        page: "pages/[project]/evaluations/new",
      },
      {
        path: "/:project/evaluations/new/choose",
        page: "pages/[project]/evaluations/new/choose",
      },
      {
        path: "/:project/evaluations/wizard",
        page: "pages/[project]/evaluations/wizard",
      },
      {
        path: "/:project/evaluations/wizard/:slug",
        page: "pages/[project]/evaluations/wizard/[slug]",
      },
      {
        path: "/:project/evaluations/:id/edit",
        page: "pages/[project]/evaluations/[id]/edit",
      },
      {
        path: "/:project/evaluations/:id/edit/choose",
        page: "pages/[project]/evaluations/[id]/edit/choose",
      },
      {
        path: "/:project/traces",
        page: "pages/[project]/traces",
      },
      {
        path: "/:project/traces/:trace",
        page: "pages/[project]/traces/[trace]",
      },

      // Legacy /messages paths. The legacy Traces page is gone; these are
      // redirects only, so old bookmarks and notification links keep working.
      {
        path: "/:project/messages",
        page: "pages/[project]/messages/index",
      },
      {
        path: "/:project/messages/:trace",
        page: "pages/[project]/messages/[trace]/index",
      },
      {
        path: "/:project/messages/:trace/:openTab",
        page: "pages/[project]/messages/[trace]/[openTab]/index",
      },
      {
        path: "/:project/messages/:trace/:openTab/:span",
        page: "pages/[project]/messages/[trace]/[openTab]/[span]",
      },
      {
        path: "/:project/prompts",
        page: "pages/[project]/prompts",
      },
      {
        path: "/:project/setup",
        page: "pages/[project]/setup",
      },
      {
        path: "/:project/workflows",
        page: "pages/[project]/workflows",
      },
      {
        path: "/:project/chat/:workflow",
        page: "pages/[project]/chat/[workflow]",
      },
      {
        path: "/:project/studio/:workflow",
        page: "pages/[project]/studio/[workflow]",
      },

      // Annotations
      {
        path: "/:project/annotations",
        page: "pages/[project]/annotations",
      },
      {
        path: "/:project/annotations/all",
        page: "pages/[project]/annotations/all",
      },
      {
        path: "/:project/annotations/me",
        page: "pages/[project]/annotations/me",
      },
      {
        path: "/:project/annotations/my-queue",
        page: "pages/[project]/annotations/my-queue",
      },
      {
        path: "/:project/annotations/:slug",
        page: "pages/[project]/annotations/[slug]",
      },

      // Analytics
      {
        path: "/:project/analytics",
        page: "pages/[project]/analytics/index",
      },
      {
        path: "/:project/analytics/evaluations",
        page: "pages/[project]/analytics/evaluations",
      },
      {
        path: "/:project/analytics/metrics",
        page: "pages/[project]/analytics/metrics",
      },
      {
        path: "/:project/analytics/reports",
        page: "pages/[project]/analytics/reports",
      },
      {
        path: "/:project/analytics/topics",
        page: "pages/[project]/analytics/topics",
      },
      {
        path: "/:project/analytics/users",
        page: "pages/[project]/analytics/users",
      },
      {
        path: "/:project/analytics/query",
        page: "pages/[project]/analytics/query",
      },
      {
        path: "/:project/analytics/custom",
        page: "pages/[project]/analytics/custom/index",
      },
      {
        path: "/:project/analytics/custom/:id",
        page: "pages/[project]/analytics/custom/[id]",
      },

      // Experiments
      {
        path: "/:project/experiments",
        page: "pages/[project]/experiments/index",
      },
      {
        path: "/:project/experiments/workbench",
        page: "pages/[project]/experiments/workbench/index",
      },
      {
        path: "/:project/experiments/workbench/:slug",
        page: "pages/[project]/experiments/workbench/[slug]",
      },
      {
        path: "/:project/experiments/:experiment",
        page: "pages/[project]/experiments/[experiment]",
      },

      // Agent Testing (catch-all, behind release_ui_agent_testing_v2_enabled)
      {
        path: "/:project/agent-testing",
        page: "pages/[project]/agent-testing/[[...path]]",
      },
      {
        path: "/:project/agent-testing/*",
        page: "pages/[project]/agent-testing/[[...path]]",
      },

      // Simulations (catch-all)
      {
        path: "/:project/simulations/scenarios",
        page: "pages/[project]/simulations/scenarios/index",
      },
      {
        path: "/:project/simulations/*",
        page: "pages/[project]/simulations/[[...path]]",
      },
      {
        path: "/:project/simulations",
        page: "pages/[project]/simulations/[[...path]]",
      },
    ],
  },

  // Ops
  { path: "/ops", page: "pages/ops/index" },
  { path: "/ops/queues", page: "pages/ops/queues" },
  { path: "/ops/dejaview", page: "pages/ops/dejaview" },
  { path: "/ops/scheduler", page: "pages/ops/scheduler" },
  {
    path: "/ops/event-sourcing",
    page: "pages/ops/event-sourcing/index",
  },
  {
    path: "/ops/event-sourcing/dead-letters",
    page: "pages/ops/event-sourcing/dead-letters",
  },
  {
    path: "/ops/event-sourcing/processes",
    page: "pages/ops/event-sourcing/processes",
  },
  {
    path: "/ops/event-sourcing/projections",
    page: "pages/ops/event-sourcing/projections",
  },
  {
    path: "/ops/event-sourcing/subscribers",
    page: "pages/ops/event-sourcing/subscribers",
  },
  {
    path: "/ops/event-sourcing/schedules",
    page: "pages/ops/event-sourcing/schedules",
  },
  { path: "/ops/blobs", page: "pages/ops/blobs" },
  {
    path: "/ops/feature-flags",
    page: "pages/ops/feature-flags",
  },
  { path: "/ops/foundry", page: "pages/ops/foundry" },
  {
    path: "/ops/migrations",
    page: "pages/ops/migrations",
  },
  {
    path: "/ops/projections",
    page: "pages/ops/projections",
  },
  {
    path: "/ops/projections/:runId",
    page: "pages/ops/projections/[runId]",
  },
  {
    path: "/ops/backoffice",
    page: "pages/ops/backoffice",
  },
  {
    path: "/ops/backoffice/bug-reports",
    page: "pages/ops/backoffice/bug-reports",
  },
  {
    path: "/ops/backoffice/users",
    page: "pages/ops/backoffice/users",
  },
  {
    path: "/ops/backoffice/organizations",
    page: "pages/ops/backoffice/organizations",
  },
  {
    path: "/ops/backoffice/projects",
    page: "pages/ops/backoffice/projects",
  },
  {
    path: "/ops/backoffice/subscriptions",
    page: "pages/ops/backoffice/subscriptions",
  },
  {
    path: "/ops/backoffice/sso-connections",
    page: "pages/ops/backoffice/sso-connections",
  },

  // @project redirect - Next.js parallel route that redirects /@project/path to /:project/path
  {
    path: "/@project/*",
    page: "pages/@project/[...path]/index",
  },

  // Catch-all 404 - must stay last.
  {
    path: "*",
    page: "pages/not-found",
  },
];
