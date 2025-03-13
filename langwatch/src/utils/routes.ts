export const projectRoutes = {
  home: {
    path: "/[project]",
    title: "Analytics",
  },
  workflows: {
    path: "/[project]/workflows",
    title: "Workflows",
  },
  messages: {
    path: "/[project]/messages",
    title: "Messages",
  },
  analytics: {
    path: "/[project]/analytics",
    title: "Analytics",
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
  experiments: {
    path: "/[project]/experiments",
    title: "Experiments",
  },
  experiments_show: {
    path: "/[project]/experiments/[experiment]",
    title: "Experiment Details",
    parent: "experiments",
  },
  prompts: {
    path: "/[project]/prompts",
    title: "Prompts DB",
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
  playground: {
    path: "/[project]/playground",
    title: "Playground",
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
};

export type Route = {
  path: string;
  title: string;
  parent?: keyof typeof projectRoutes;
};

type RouteMap = Record<keyof typeof projectRoutes, Route>;

export const findCurrentRoute = (
  currentPathname: string
): Route | undefined => {
  return Object.values(projectRoutes as RouteMap).find(
    (route) => route.path === currentPathname
  );
};
