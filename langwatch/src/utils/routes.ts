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
  checks: {
    path: "/[project]/guardrails",
    title: "Checks",
  },
  checks_new: {
    path: "/[project]/guardrails/new",
    title: "New Check",
    parent: "checks",
  },
  checks_edit: {
    path: "/[project]/guardrails/[id]/edit",
    title: "Editing Check",
    parent: "checks",
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
