type Route = {
  path: string;
  title: string;
};

export const routes = {
  home: {
    path: "/",
    title: "Home",
  },
  messages: {
    path: "/messages",
    title: "Messages Explorer",
  },
  analytics: {
    path: "/analytics",
    title: "Analytics",
  },
  security: {
    path: "/security",
    title: "Security Checks",
  },
  prompts: {
    path: "/prompts",
    title: "Prompts DB",
  },
};

export const findCurrentRoute = (currentPathname: string): Route | undefined =>
  Object.values(routes).find((route) => route.path === currentPathname);
