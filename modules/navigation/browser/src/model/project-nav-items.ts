/** Project menu destinations; narrowing the actual menu used, not deleted platform/app table */

/** One destination the project menu offers. */
export type ProjectNavItem = {
  path: string;
  title: string;
};

export const projectNavItems = {
  home: { path: "/[project]", title: "Home" },
  analytics: { path: "/[project]/analytics", title: "Analytics" },
  dashboards: { path: "/[project]/dashboards", title: "Dashboards" },
  traces_v2: { path: "/[project]/traces", title: "Trace Explorer" },
  online_evaluations: {
    path: "/[project]/online-evaluations",
    title: "Online Evaluations",
  },
  coding_agent_sessions: { path: "/[project]/sessions", title: "Sessions" },
  coding_agent_pull_requests: {
    path: "/[project]/pull-requests",
    title: "Pull requests",
  },
  simulations: { path: "/[project]/simulations", title: "Simulations" },
  simulation_runs: { path: "/[project]/simulations", title: "Runs" },
  scenarios: { path: "/[project]/simulations/scenarios", title: "Scenarios" },
  agent_testing: { path: "/[project]/agent-testing", title: "Agent Testing" },
  experiments: { path: "/[project]/experiments", title: "Experiments" },
  annotations: { path: "/[project]/annotations", title: "Annotations" },
  prompts: { path: "/[project]/prompts", title: "Prompts" },
  agents: { path: "/[project]/agents", title: "Agents" },
  workflows: { path: "/[project]/workflows", title: "Workflows" },
  evaluators: { path: "/[project]/evaluators", title: "Evaluators" },
  datasets: { path: "/[project]/datasets", title: "Datasets" },
  automations: { path: "/[project]/automations", title: "Automations" },
  settings: { path: "/settings", title: "Settings" },
} as const satisfies Record<string, ProjectNavItem>;

export type ProjectNavKey = keyof typeof projectNavItems;

/** Destination name for document title; exact address match, not closest guess */
export function projectNavItemAt(pathname: string): ProjectNavItem | undefined {
  return Object.values(projectNavItems).find((item) => item.path === pathname);
}

/**
 * Where a route pattern stands in the Dashboards area: `undefined` outside it,
 * otherwise the board it opens (`dashboardId` absent on the area's own address).
 */
export function dashboardsAreaAt(pattern: string): { dashboardId: string | undefined } | undefined {
  const area = projectNavItems.dashboards.path;
  if (pattern === area) return { dashboardId: void 0 };
  if (!pattern.startsWith(`${area}/`)) return void 0;
  const [dashboardId] = pattern.slice(area.length + 1).split("/");
  return { dashboardId: dashboardId || void 0 };
}

/** Address to route pattern; normalize for pattern-based tests vs address-based host */
export function toProjectRoutePattern({
  pathname,
  projectSlug,
}: {
  pathname: string;
  projectSlug: string | undefined;
}): string {
  if (!projectSlug) return pathname;
  if (pathname === `/${projectSlug}`) return "/[project]";
  if (pathname.startsWith(`/${projectSlug}/`)) {
    return `/[project]${pathname.slice(projectSlug.length + 1)}`;
  }
  return pathname;
}
