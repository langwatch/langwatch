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
  security: {
    path: "/[project]/security",
    title: "Security Checks",
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
