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
    path: "/[project]/checks",
    title: "Checks",
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
  message_span: {
    path: "/[project]/messages/[trace]/[span]",
    title: "Trace",
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
