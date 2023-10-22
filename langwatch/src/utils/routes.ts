import type { Project } from "@prisma/client";

type Route = {
  path: string;
  title: string;
};

export const getProjectRoutes = (project: Project) => ({
  home: {
    path: `/${project.slug}`,
    title: "Home",
  },
  messages: {
    path: `/${project.slug}/messages`,
    title: "Messages Explorer",
  },
  analytics: {
    path: `/${project.slug}/analytics`,
    title: "Analytics",
  },
  security: {
    path: `/${project.slug}/security`,
    title: "Security Checks",
  },
  prompts: {
    path: `/${project.slug}/prompts`,
    title: "Prompts DB",
  },
});

export const findCurrentRoute = (
  project: Project,
  currentPathname: string
): Route | undefined => {
  const pathname = currentPathname.replace("[project]", project.slug);
  return Object.values(getProjectRoutes(project)).find(
    (route) => route.path === pathname
  );
};
