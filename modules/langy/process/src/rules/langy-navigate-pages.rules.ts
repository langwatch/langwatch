/**
 * The closed set of page names `langwatch navigate open <name>` may address.
 * "Take me to my prompts" names a page, not a resource: a fixed table maps
 * names to project-scoped paths, and anything outside it is not a destination.
 */

const NAVIGATE_PAGES: Record<string, string> = {
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

/**
 * The project-relative path this page name addresses, or null when the name is
 * not a page. Matched case-insensitively: these are words an agent types, not
 * ids.
 */
export function navigatePagePathFor(name: string): string | null {
  return NAVIGATE_PAGES[name.toLowerCase()] ?? null;
}
