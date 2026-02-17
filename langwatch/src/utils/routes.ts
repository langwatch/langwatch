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
    path: "/[project]/suites",
    title: "Suites",
    parent: "simulations",
  },
  simulations_batch: {
    path: "/[project]/simulations/[scenarioSetId]/[batchRunId]",
    title: "Runs",
    parent: "simulations",
  },
  simulations_run: {
    path: "/[project]/simulations/[scenarioSetId]/[batchRunId]/[scenarioRunId]",
    title: "Simulation Run",
    parent: "simulations",
  },
  evaluators: {
    path: "/[project]/evaluators",
    title: "Evaluators",
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
