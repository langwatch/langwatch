/**
 * Where the project menu's entries point, and what they are called.
 *
 * NOT A COPY OF `platform/app/src/utils/routes.ts` — that table no longer
 * exists. Commit `72ed591a13` deleted it while this move was in flight, which
 * is what left `MainMenu` reading a module that was already gone. What is here
 * is the narrowing the MENU actually used: nineteen destinations out of a
 * seventy-entry table whose other fifty are breadcrumb parents, trace detail
 * pages and switch-href machinery, none of which a sidebar asks about.
 *
 * The `[project]` placeholder is kept exactly as the table spelled it, because
 * `projectScopedDestination` is what fills it in and it is what tells an entry
 * with no project yet to render inert instead of pointing somewhere wrong.
 *
 * The addresses are the product's, not this package's invention: every one of
 * them is served today, and `apps/ui`'s own route table names the same paths.
 * They are stated here rather than read from there because a governed web
 * package may not import the application that mounts it.
 */

/** One destination the project menu offers. */
export type ProjectNavItem = {
  path: string;
  title: string;
};

export const projectNavItems = {
  home: { path: "/[project]", title: "Home" },
  analytics: { path: "/[project]/analytics", title: "Analytics" },
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

/**
 * The name of the destination on screen, for the document title.
 *
 * An exact match on the address, the way `findCurrentRoute` matched a route
 * pattern: a page this menu does not offer contributes no title fragment
 * rather than the closest guess, which is the honest answer for the many pages
 * the sidebar never lists.
 */
export function projectNavItemAt(pathname: string): ProjectNavItem | undefined {
  return Object.values(projectNavItems).find((item) => item.path === pathname);
}

/**
 * A project-anchored address, written back as the route pattern.
 *
 * Every active-state test in the menu was written against `router.pathname` —
 * the PATTERN, `/[project]/sessions`, not the address `/acme/sessions`. The
 * host answers with the address, because that is the only thing a settings
 * entry can be matched against (every settings page but two resolves to one
 * registered pattern). Normalising here is what lets both kinds of test keep
 * the exact comparison they were written with.
 *
 * An address outside the project comes back unchanged: `/settings/usage` is
 * already the pattern it matches on.
 */
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
