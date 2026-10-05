/**
 * The application's URL surface, as data — a page is named by its
 * loader KEY, not imported, so it can move into a feature-web `screens/`
 * entry with only the loader repointed. Turned into routes elsewhere.
 */

export type UiRedirectDescriptor = {
  /**
   * The retired address; whatever the matched path carries BEYOND this
   * travels to the destination. A `:name` anywhere fills from matched
   * route params, so a parameterised retirement needs no page of its own.
   */
  readonly from: string;
  readonly to: string;
  /**
   * Query params forced onto the destination, overriding whatever the old
   * address carried under those keys. See `UiPrefixRedirect`, which is what
   * renders this.
   */
  readonly pinParams?: Readonly<Record<string, string>>;
  /** Query params carried across under a new key. */
  readonly renameParams?: Readonly<Record<string, string>>;
  /**
   * A rename table for the first sub-path segment: `/admin/user/u_1`
   * reaches `/ops/users/u_1`. Case-insensitive; an unnamed
   * segment lands on the destination's own home.
   */
  readonly mapSegment?: Readonly<Record<string, string>>;
};

/** A route that renders a page, or a pathless layout route that wraps others. */
export type UiPageRouteDescriptor = {
  readonly path?: string;
  /** The key the composing application registers this page's loader under. */
  readonly page: string;
  /** The explicit native route mount point for a pre-router web installation. */
  readonly webRouteParent?: "project";
  /** An account page (`/me`, Settings > Profile and Security): the shell draws its title large. */
  readonly heading?: "account";
  readonly children?: readonly UiRouteDescriptor[];
};

/** A pathless layout the SHELL draws itself: chrome is composition, not a module page. */
export type UiShellLayout = "auth" | "chrome" | "full-screen";

/**
 * A layout route the shell resolves from its own source. It carries no page
 * key deliberately - a key is an address a MODULE answers for, and no module
 * owns the frame the application draws around every one of them.
 */
export type UiLayoutRouteDescriptor = {
  readonly layout: UiShellLayout;
  /** Always absent: this layout is pathless, and stating it keeps the union readable. */
  readonly path?: undefined;
  readonly children?: readonly UiRouteDescriptor[];
};

/** A retired address that forwards to its new home. */
export type UiRedirectRouteDescriptor = {
  readonly path: string;
  readonly redirect: UiRedirectDescriptor;
};

export type UiRouteDescriptor =
  | UiPageRouteDescriptor
  | UiRedirectRouteDescriptor
  | UiLayoutRouteDescriptor;

/**
 * Every descriptor, flattened into match order — nesting only joins a
 * layout to the pages it wraps, and every path is absolute, so a flat
 * list ranks the same way the router does.
 */
export function uiRouteDescriptors(table: readonly UiRouteDescriptor[]): UiRouteDescriptor[] {
  return table.flatMap((descriptor) =>
    "redirect" in descriptor
      ? [descriptor]
      : [descriptor, ...uiRouteDescriptors(descriptor.children ?? [])],
  );
}

/** Retired admin and back-office segments -> their home under `/ops`; others land on `/ops`. */
const RETIRED_ADMIN_SEGMENTS: Readonly<Record<string, string>> = {
  user: "users",
  users: "users",
  organization: "organizations",
  organizations: "organizations",
  project: "projects",
  projects: "projects",
  "sso-connections": "sso-connections",
  "identity-lookup": "identity-lookup",
  "directory-sync": "directory-sync",
  subscription: "cloud/subscriptions",
  subscriptions: "cloud/subscriptions",
  licenses: "cloud/licenses",
  "self-hosted-instances": "cloud/self-hosted-instances",
  "bug-reports": "cloud/bug-reports",
};

/**
 * Prefixes that moved to a new top-level home — the whole prefix
 * forwards with sub-path/query/hash intact, so old links keep landing.
 * Specs: gateway-url-move.feature, governance-home-routing.feature.
 */
export const uiLegacyRedirectRoutes: readonly UiRedirectRouteDescriptor[] = [
  // Sources has had three addresses: ingestion-sources -> catalog ->
  // inventory Sources tab. Every retired address maps STRAIGHT to its
  // final home, no chaining. Bare forms pin ?tab=sources; deep links go to the detail page.
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
    // Anomaly rules left the inventory's tabs; the pinned tab falls back to Catalog.
    path: "/governance/anomaly-rules",
    redirect: {
      from: "/governance/anomaly-rules",
      to: "/governance/inventory",
      pinParams: { tab: "anomaly-rules" },
    },
  },
  {
    // Exact match only: /governance/users/:id keeps its own detail route.
    path: "/governance/users",
    redirect: {
      from: "/governance/users",
      to: "/governance/people",
      pinParams: { tab: "people" },
    },
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
  // Auth (public), under the host every front-door screen reads its
  // deployment shape and its own address through.
  {
    layout: "auth",
    children: [
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
      // Join before create (ADR-117 §6): a new account passes through here on
      // its way to making an organization. Renders nothing until D12 fills it.
      { path: "/auth/join", page: "pages/auth/join" },
      {
        path: "/auth/sso-test-complete",
        page: "pages/auth/sso-test-complete",
      },
      // Auth's own screen, and it reads auth's host: accepting an invite is a
      // front-door act, done signed-out as often as signed-in.
      { path: "/invite/accept", page: "pages/invite/accept" },
    ],
  },

  // Top-level pages
  // The admin CRUD UI's addresses; singular resource names travel as a
  // segment map. The bare address lands on Cloud admin (ARCHITECTURE.md §3.5).
  { path: "/admin", redirect: { from: "/admin", to: "/ops/cloud" } },
  {
    path: "/admin/*",
    redirect: { from: "/admin", to: "/ops", mapSegment: RETIRED_ADMIN_SEGMENTS },
  },
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

  // CLI device-flow approval (RFC 8628 user-facing screen). Top level, like
  // /onboarding: it is a confirm-a-code screen, not a page of the app, so it
  // carries neither the chrome nor the Langy panel.
  // Spec: specs/langy/langy-mount-scope.feature
  { path: "/cli/auth", page: "pages/cli/auth" },

  // Key and MCP consent: standalone branded cards, the project switcher lent
  // into the card by the api-key host mount rather than drawn by the chrome.
  { path: "/authorize", page: "pages/authorize" },
  { path: "/mcp/authorize", page: "pages/mcp/authorize" },

  // The published workflow chat is a chromeless page, as it was on main: one
  // full-height card with the wordmark, no header, sidebar or Langy panel.
  { path: "/:project/chat/:workflow", page: "pages/[project]/chat/[workflow]" },

  // The studio canvas fills the viewport, as on main: the chrome's session and
  // project gates, the trace drawer and Langy, but no top bar or sidebar.
  {
    layout: "full-screen",
    children: [
      {
        page: "layouts/trace-drawer",
        children: [
          {
            page: "layouts/project-langy",
            children: [
              {
                path: "/:project/studio/:workflow",
                page: "pages/[project]/studio/[workflow]",
              },
            ],
          },
        ],
      },
    ],
  },

  // Everything behind a session, wrapped in the application chrome.
  {
    layout: "chrome",
    children: [
      {
        page: "layouts/trace-drawer",
        children: [
          // `/` resolves which home this reader belongs in, which is a reading only
          // the navigation host answers — and the host is mounted by this layout.
          // Outside it the landing screen threw for want of a host, which is how a
          // signed-in reader met an error page at the front door.
          { path: "/", page: "pages/index" },
          // Settings, wrapped in the same Langy layout as the project routes
          // (keyed by the AMBIENT project), so the panel survives hopping between
          // a project page and settings instead of vanishing.
          {
            page: "layouts/project-langy",
            children: [
              { path: "/settings", page: "pages/settings" },
              {
                // Role Bindings became the Roles page's assignments tab.
                path: "/settings/role-bindings",
                redirect: {
                  from: "/settings/role-bindings",
                  to: "/settings/roles",
                  pinParams: { tab: "assignments" },
                },
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
                path: "/settings/authentication/provider",
                page: "pages/settings/authentication/provider",
              },
              {
                path: "/settings/authentication/connectors",
                page: "pages/settings/authentication/connectors",
              },
              {
                path: "/settings/security",
                page: "pages/settings/security",
                heading: "account",
              },
              {
                // Members, Teams, Groups and SCIM became the Directory and its tabs.
                path: "/settings/directory",
                page: "pages/settings/directory",
              },
              {
                path: "/settings/groups",
                redirect: {
                  from: "/settings/groups",
                  to: "/settings/directory",
                  pinParams: { tab: "groups" },
                },
              },
              {
                // Access's switches moved to Directory and Authentication; it lands on Directory.
                path: "/settings/access",
                redirect: { from: "/settings/access", to: "/settings/directory" },
              },
              {
                path: "/settings/connect",
                page: "pages/settings/connect",
              },
              {
                path: "/settings/checkup",
                page: "pages/settings/checkup",
              },
              {
                path: "/settings/license",
                page: "pages/settings/license",
              },
              {
                // The old `tab` named a cut of the people; it travels as `people`.
                path: "/settings/members",
                redirect: {
                  from: "/settings/members",
                  to: "/settings/directory",
                  renameParams: { tab: "people" },
                },
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
                path: "/settings/profile",
                page: "pages/settings/profile",
                heading: "account",
              },
              {
                path: "/settings/scim",
                redirect: { from: "/settings/scim", to: "/settings/directory" },
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
                redirect: {
                  from: "/settings/teams",
                  to: "/settings/directory",
                  pinParams: { tab: "teams" },
                },
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
                // An address under /settings that names no page. Inside this group
                // rather than on the table's own catch-all, so the settings
                // navigation and the top bar stay drawn around it — `platform/app`
                // framed its 404 in `DashboardLayout` for the same reason, and a
                // bare full-viewport 404 leaves a reader with no way back.
                path: "/settings/*",
                page: "pages/settings/not-found",
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
                path: "/governance/people",
                page: "pages/governance/people",
              },
              {
                // The agents detected across the organization, as one list.
                path: "/governance/agents",
                page: "pages/governance/agents",
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
                // The Platform placeholders, behind the same flag as costs/billed
                // (each page carries its own guard; see
                // specs/governance/governance-platform-placeholders.feature).
                path: "/governance/insights",
                page: "pages/governance/insights",
              },
              {
                path: "/governance/analytics",
                page: "pages/governance/analytics",
              },
              {
                path: "/governance/signals",
                page: "pages/governance/signals",
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
                heading: "account",
              },
              {
                path: "/me/configure",
                page: "pages/me/configure",
                heading: "account",
              },
              {
                // The devices inventory moved into a tab of /me/configure, and this
                // path keeps resolving so old links do not dead-end.
                path: "/me/devices",
                redirect: {
                  from: "/me/devices",
                  to: "/me/configure",
                  pinParams: { tab: "devices" },
                },
              },
              {
                path: "/me/pull-requests",
                page: "pages/me/pull-requests",
                heading: "account",
              },
              {
                path: "/me/sessions",
                page: "pages/me/sessions",
                heading: "account",
              },
              {
                // Budget-increase request page that the CLI's `langwatch request-increase`
                // opens. The page file existed but routes.tsx is explicit (Vite migration)
                // - without this entry the URL 404'd, breaking the per-spec
                // budget-exceeded → request flow Ariana caught in dogfood.
                path: "/me/budget/request",
                page: "pages/me/budget/request",
                heading: "account",
              },

              // AI Gateway: org-scoped admin pages live under /gateway/** at the top level,
              // like /governance. Every gateway resource (VirtualKey / GatewayBudget /
              // ModelProvider) is org-keyed by the schema, so the chrome reflects that.
              {
                // The bare address is a redirect and never a page.
                // Spec: specs/navigation/gateway-url-move.feature
                // (The bare gateway address lands on the virtual keys list).
                path: "/gateway",
                redirect: { from: "/gateway", to: "/gateway/virtual-keys" },
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

          // Project routes — wrapped in a layout route that mounts Langy ONCE per project,
          // above the swapping page, so the panel + composer draft + any in-flight response
          // survive navigation between project pages.
          {
            page: "layouts/project-langy",
            webRouteParent: "project",
            children: [
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
                path: "/:project/automations/activity",
                page: "pages/[project]/automations/activity",
              },
              {
                path: "/:project/evaluators",
                page: "pages/[project]/evaluators",
              },
              {
                // The page's default export was nothing but this replace; a table row
                // says the same thing without a loader.
                path: "/:project/evaluations",
                redirect: {
                  from: "/:project/evaluations",
                  to: "/:project/experiments",
                },
              },
              {
                // Creating an evaluation is a drawer on the online-evaluations page;
                // both retired addresses served the same forward, so both open it.
                path: "/:project/evaluations/new",
                redirect: {
                  from: "/:project/evaluations/new",
                  to: "/:project/online-evaluations",
                  pinParams: { "drawer.open": "evaluatorCategorySelector" },
                },
              },
              {
                path: "/:project/evaluations/new/choose",
                redirect: {
                  from: "/:project/evaluations/new/choose",
                  to: "/:project/online-evaluations",
                  pinParams: { "drawer.open": "evaluatorCategorySelector" },
                },
              },
              {
                // The evaluation wizard was retired in favour of the experiments workbench,
                // and a brand-new evaluation always opened it.
                path: "/:project/evaluations/wizard",
                redirect: {
                  from: "/:project/evaluations/wizard",
                  to: "/:project/experiments/workbench",
                },
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
                // The canonical short link to one trace — notification links, emails,
                // webhooks and API responses all mint it. Trace Explorer shows a
                // trace in a drawer, so the id travels as the drawer's parameter.
                path: "/:project/traces/:trace",
                redirect: {
                  from: "/:project/traces/:trace",
                  to: "/:project/traces",
                  pinParams: {
                    "drawer.open": "traceV2Details",
                    "drawer.traceId": ":trace",
                  },
                  renameParams: { t: "drawer.t" },
                },
              },

              // Legacy /messages paths. The legacy Traces page is gone; these are
              // redirects only, so old bookmarks and notification links keep working.
              {
                // The bare legacy index keeps every filter and date range the saved
                // link carried; the Trace Explorer ignores what it does not know.
                path: "/:project/messages",
                redirect: { from: "/:project/messages", to: "/:project/traces" },
              },
              {
                path: "/:project/messages/:trace",
                redirect: {
                  from: "/:project/messages/:trace",
                  to: "/:project/traces",
                  pinParams: {
                    "drawer.open": "traceV2Details",
                    "drawer.traceId": ":trace",
                  },
                },
              },
              {
                // The legacy tab has no Trace Explorer equivalent, so it is dropped.
                path: "/:project/messages/:trace/:openTab",
                redirect: {
                  from: "/:project/messages/:trace/:openTab",
                  to: "/:project/traces",
                  pinParams: {
                    "drawer.open": "traceV2Details",
                    "drawer.traceId": ":trace",
                  },
                },
              },
              {
                path: "/:project/messages/:trace/:openTab/:span",
                redirect: {
                  from: "/:project/messages/:trace/:openTab/:span",
                  to: "/:project/traces",
                  pinParams: {
                    "drawer.open": "traceV2Details",
                    "drawer.traceId": ":trace",
                    "drawer.span": ":span",
                  },
                },
              },
              {
                path: "/:project/setup",
                page: "pages/[project]/setup",
              },
              {
                path: "/:project/workflows",
                page: "pages/[project]/workflows",
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
                path: "/:project/analytics/custom",
                page: "pages/[project]/analytics/custom/index",
              },
              {
                path: "/:project/analytics/custom/:id",
                page: "pages/[project]/analytics/custom/[id]",
              },

              // Dashboards v1 (behind release_dashboards; the screens gate themselves)
              {
                path: "/:project/dashboards",
                page: "pages/[project]/dashboards/index",
              },
              {
                path: "/:project/dashboards/:dashboardId",
                page: "pages/[project]/dashboards/[dashboardId]",
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
          {
            // Queue health reads on the dashboard now; the retired page forwarded
            // there and nothing else.
            path: "/ops/queues",
            redirect: { from: "/ops/queues", to: "/ops" },
          },
          { path: "/ops/dejaview", page: "pages/ops/dejaview" },
          {
            // Schedules are a section of the event-sourcing workspace; old links
            // follow.
            path: "/ops/scheduler",
            redirect: { from: "/ops/scheduler", to: "/ops/event-sourcing/schedules" },
          },
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
            // Projection replay is a drawer on the event-sourcing page now, so the
            // old address has to open the drawer as well as land on the page. Per-run
            // progress keeps its own page at /ops/projections/:runId below.
            path: "/ops/projections",
            redirect: {
              from: "/ops/projections",
              to: "/ops/event-sourcing/projections",
              // The replay wizard is a drawer the projections screen addresses with
              // its OWN query key now — the application drawer registry is a
              // composition `@langwatch/ops-browser` may not carry — so the retired
              // address pins that key instead. Same page, same drawer open.
              pinParams: { replay: "open" },
            },
          },
          {
            path: "/ops/projections/:runId",
            page: "pages/ops/projections/[runId]",
          },
          // Instance administration, for every instance operator (ARCHITECTURE.md §3.5).
          { path: "/ops/operators", page: "pages/ops/operators" },
          { path: "/ops/users", page: "pages/ops/users" },
          { path: "/ops/organizations", page: "pages/ops/organizations" },
          { path: "/ops/projects", page: "pages/ops/projects" },
          { path: "/ops/sso-connections", page: "pages/ops/sso-connections" },
          { path: "/ops/identity-lookup", page: "pages/ops/identity-lookup" },
          { path: "/ops/directory-sync", page: "pages/ops/directory-sync" },
          // Cloud admin: its screens refuse opaquely off SaaS (ARCHITECTURE.md §3.5).
          {
            path: "/ops/cloud",
            redirect: { from: "/ops/cloud", to: "/ops/cloud/subscriptions" },
          },
          { path: "/ops/cloud/subscriptions", page: "pages/ops/cloud/subscriptions" },
          { path: "/ops/cloud/licenses", page: "pages/ops/cloud/licenses" },
          {
            path: "/ops/cloud/self-hosted-instances",
            page: "pages/ops/cloud/self-hosted-instances",
          },
          { path: "/ops/cloud/bug-reports", page: "pages/ops/cloud/bug-reports" },
          // The retired back-office addresses: the bare one lands on Cloud admin,
          // each page on its new home, anything else on the Ops home.
          {
            path: "/ops/backoffice",
            redirect: { from: "/ops/backoffice", to: "/ops/cloud" },
          },
          {
            path: "/ops/backoffice/*",
            redirect: { from: "/ops/backoffice", to: "/ops", mapSegment: RETIRED_ADMIN_SEGMENTS },
          },

          // Both read the navigation host, which only this layout mounts; main drew
          // its 404 inside the dashboard layout too.
          // Spec: specs/navigation/project-address-redirect.feature
          {
            path: "/@project/*",
            page: "pages/@project/[...path]/index",
          },
        ],
      },

      // Catch-all 404 - must stay last, outside the trace drawer's layout.
      {
        path: "*",
        page: "pages/not-found",
      },
    ],
  },
];
