export const projectRoutes = {
  home: {
    path: "/[project]",
    title: "Home",
  },
  analytics: {
    path: "/[project]/analytics",
    title: "Analytics",
  },
  workflows: {
    path: "/[project]/workflows",
    title: "Workflows",
  },
  messages: {
    path: "/[project]/messages",
    title: "Traces",
  },
  traces_v2: {
    path: "/[project]/traces",
    title: "Trace Explorer",
  },
  evaluations: {
    path: "/[project]/evaluations",
    title: "Evaluations",
  },
  evaluations_new_choose: {
    path: "/[project]/evaluations/new/choose",
    title: "New Evaluation",
    parent: "evaluations",
  },
  evaluations_new: {
    path: "/[project]/evaluations/new",
    title: "New Evaluation",
    parent: "evaluations",
  },
  evaluations_edit_choose: {
    path: "/[project]/evaluations/[id]/edit/choose",
    title: "Editing Evaluation",
    parent: "evaluations",
  },
  evaluations_edit: {
    path: "/[project]/evaluations/[id]/edit",
    title: "Editing Evaluation",
    parent: "evaluations",
  },
  experiments_workbench: {
    path: "/[project]/experiments/workbench/[slug]",
    title: "Experiments Workbench",
    parent: "evaluations",
  },
  evaluations_wizard: {
    path: "/[project]/evaluations/wizard/[slug]",
    title: "Evaluation Wizard",
    parent: "evaluations",
  },
  experiments: {
    path: "/[project]/experiments",
    title: "Experiments",
  },
  experiments_show: {
    path: "/[project]/experiments/[experiment]",
    title: "Experiment Details",
    parent: "experiments",
  },
  message: {
    path: "/[project]/messages/[trace]",
    title: "Trace",
    parent: "messages",
  },
  message_open_tab: {
    path: "/[project]/messages/[trace]/[opentab]",
    title: "trace",
    parent: "messages",
  },
  message_open_tab_span: {
    path: "/[project]/messages/[trace]/[opentab]/[span]",
    title: "trace",
    parent: "messages",
  },
  settings: {
    path: "/settings",
    title: "Settings",
  },
  datasets: {
    path: "/[project]/datasets",
    title: "Datasets",
  },
  dataset_edit: {
    path: "/[project]/datasets/[id]",
    title: "Editing Dataset",
    parent: "datasets",
  },
  annotations: {
    path: "/[project]/annotations",
    title: "Annotations",
  },
  annotations_queues: {
    path: "/[project]/annotations/[slug]",
    title: "Annotations Queues",
    parent: "annotations",
  },
  annotations_all: {
    path: "/[project]/annotations/all",
    title: "All Annotations",
    parent: "annotations",
  },
  annotations_user_inbox: {
    path: "/[project]/annotations/me",
    title: "Annotations Inbox",
    parent: "annotations",
  },
  annotations_my_queue: {
    path: "/[project]/annotations/my-queue",
    title: "My Queue",
    parent: "annotations",
  },
  triggers: {
    path: "/[project]/triggers",
    title: "Triggers",
  },
  prompts: {
    path: "/[project]/prompts",
    title: "Prompts",
  },
  simulations: {
    path: "/[project]/simulations",
    title: "Simulations",
  },
  agents: {
    path: "/[project]/agents",
    title: "Agents",
  },
  simulation_runs: {
    path: "/[project]/simulations",
    title: "Runs",
    parent: "simulations",
  },
  scenarios: {
    path: "/[project]/simulations/scenarios",
    title: "Scenarios",
    parent: "simulations",
  },
  suites: {
    path: "/[project]/simulations/suites",
    title: "Run Plans",
    parent: "simulations",
  },
  simulations_suite_detail: {
    path: "/[project]/simulations/run-plans/[suiteSlug]",
    title: "Run Plan",
    parent: "simulation_runs",
  },
  simulations_suite_batch: {
    path: "/[project]/simulations/run-plans/[suiteSlug]/[batchId]",
    title: "Run Plan",
    parent: "simulation_runs",
  },
  simulations_external_set: {
    path: "/[project]/simulations/[externalSetSlug]",
    title: "Simulation Run",
    parent: "simulation_runs",
  },
  simulations_external_batch: {
    path: "/[project]/simulations/[externalSetSlug]/[batchId]",
    title: "Simulation Run",
    parent: "simulation_runs",
  },
  simulations_run: {
    path: "/[project]/simulations/[scenarioSetId]/[batchRunId]/[scenarioRunId]",
    title: "Simulation Run",
    parent: "simulation_runs",
  },
  evaluators: {
    path: "/[project]/evaluators",
    title: "Evaluators",
  },
  gateway: {
    path: "/settings/gateway",
    title: "AI Gateway",
  },
  gateway_virtual_keys: {
    path: "/settings/gateway/virtual-keys",
    title: "Virtual Keys",
    parent: "gateway",
  },
  gateway_virtual_key_detail: {
    path: "/settings/gateway/virtual-keys/[id]",
    title: "Virtual Key",
    parent: "gateway_virtual_keys",
  },
  gateway_budgets: {
    path: "/settings/gateway/budgets",
    title: "Budgets",
    parent: "gateway",
  },
  gateway_budget_detail: {
    path: "/settings/gateway/budgets/[id]",
    title: "Budget",
    parent: "gateway_budgets",
  },
  gateway_usage: {
    path: "/settings/gateway/usage",
    title: "Usage",
    parent: "gateway",
  },
  gateway_cache_rules: {
    path: "/settings/gateway/cache-rules",
    title: "Cache Rules",
    parent: "gateway",
  },
  ops: {
    path: "/ops",
    title: "Ops",
  },
  opsDejaview: {
    path: "/ops/dejaview",
    title: "Deja View",
  },
} as const;

export type Route = {
  path: string;
  title: string;
  parent?: keyof typeof projectRoutes;
};

type RouteMap = Record<keyof typeof projectRoutes, Route>;

export const findCurrentRoute = (
  currentPathname: string,
): Route | undefined => {
  return Object.values(projectRoutes as RouteMap).find(
    (route) => route.path === currentPathname,
  );
};

export function getRoutePath(params: {
  projectSlug: string;
  route: keyof typeof projectRoutes;
}): string {
  const { projectSlug, route } = params;
  const path = projectRoutes[route].path.replace("[project]", projectSlug);
  return path.replace(/\/\/+/g, "/");
}

/**
 * Build a route path with dynamic parameters.
 * Replaces [param] placeholders with provided values.
 */
export function buildRoutePath(
  route: keyof typeof projectRoutes,
  params: Record<string, string>,
): string {
  let path: string = projectRoutes[route].path;

  for (const [key, value] of Object.entries(params)) {
    path = path.replace(`[${key}]`, value);
  }

  return path.replace(/\/\/+/g, "/");
}

/**
 * Resolve where switching to another project should land, preserving the
 * current view when the target project has an equivalent of it. The single
 * source of truth for both the WorkspaceSwitcher (via `useWorkspaceData`) and
 * the legacy `ProjectSelector`, which previously each carried their own copy of
 * this branching - the drift between them was the "switching projects always
 * goes home" regression.
 *
 * Resolution, in order:
 *   1. Project-anchored route (`/[project]/...`): swap the slug so the same
 *      view opens for the target. If the route has a second dynamic segment
 *      (a trace / eval id that can't exist in another project) it drops to the
 *      parent list route instead of 404ing.
 *   2. A literal path that embeds the current slug (non-`[project]` route that
 *      still names the project): replace the slug in place.
 *   3. No per-project equivalent (org-scoped, personal, settings): fall back to
 *      the project home. `homeFallback: "returnTo"` appends the current path as
 *      a `return_to` query (legacy ProjectSelector behavior) so the project
 *      root can bounce back; `"plain"` just lands on the project home (what the
 *      org-scope WorkspaceSwitcher wants).
 *
 * `routePattern` is the Next.js route pattern (`router.pathname`, e.g.
 * `/[project]/messages`); `resolvedPathname` is the concrete URL path
 * (`window.location.pathname`, e.g. `/acme/messages`) used for the literal-slug
 * and return_to branches.
 */
export function buildProjectSwitchHref({
  routePattern,
  targetSlug,
  resolvedPathname,
  currentProjectSlug,
  homeFallback,
}: {
  routePattern: string;
  targetSlug: string;
  resolvedPathname?: string;
  currentProjectSlug?: string;
  homeFallback: "plain" | "returnTo";
}): string {
  const currentRoute = findCurrentRoute(routePattern);

  if (currentRoute?.path.includes("[project]")) {
    const hasOtherDynamicSegments = currentRoute.path
      .replace("[project]", "")
      .includes("[");
    if (hasOtherDynamicSegments && currentRoute.parent) {
      return projectRoutes[currentRoute.parent].path
        .replace("[project]", targetSlug)
        .replace(/\/\/+/g, "/");
    }
    return currentRoute.path
      .replace("[project]", targetSlug)
      .replace(/\/\/+/g, "/");
  }

  if (currentProjectSlug && resolvedPathname?.includes(currentProjectSlug)) {
    return resolvedPathname.replace(currentProjectSlug, targetSlug);
  }

  if (homeFallback === "returnTo" && resolvedPathname) {
    return `/${targetSlug}?return_to=${encodeURIComponent(resolvedPathname)}`;
  }

  return `/${targetSlug}`;
}
