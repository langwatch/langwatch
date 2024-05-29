export const projectRoutes = {
  home: {
    path: "/[project]",
    title: "Home",
  },
  messages: {
    path: "/[project]/messages",
    title: "Messages Explorer",
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
