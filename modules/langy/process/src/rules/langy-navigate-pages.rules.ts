/**
 * The closed set of page names `langwatch navigate open <name>` may address.
 * "Take me to my prompts" names a page, not a resource: a fixed table maps
 * names to paths, and anything outside it is not a destination.
 */

const NAVIGATE_PROJECT_PAGES: Record<string, string> = {
  prompts: "/prompts",
  datasets: "/datasets",
  evaluations: "/evaluations",
  "online-evaluations": "/online-evaluations",
  evaluators: "/evaluators",
  traces: "/traces",
  simulations: "/simulations",
  experiments: "/experiments",
  workflows: "/workflows",
  agents: "/agents",
  analytics: "/analytics",
  annotations: "/annotations",
  automations: "/automations",
};

/** Pages beside the project pages rather than inside one: built with no slug. */
const NAVIGATE_ORGANIZATION_PAGES: Record<string, string> = {
  "governance-sources": "/governance/inventory?tab=sources",
};

/** A page's path, and whether it sits under the project slug or at the top level. */
export type NavigatePage = { scope: "project" | "organization"; path: string };

/**
 * The page this name addresses, or null when the name is not a page. Matched
 * case-insensitively: these are words an agent types, not ids.
 */
export function pickNavigatePage(name: string): NavigatePage | null {
  const key = name.toLowerCase();
  const projectPath = NAVIGATE_PROJECT_PAGES[key];
  if (projectPath) return { scope: "project", path: projectPath };
  const organizationPath = NAVIGATE_ORGANIZATION_PAGES[key];
  if (organizationPath) return { scope: "organization", path: organizationPath };
  return null;
}
