/**
 * The page destinations `langwatch navigate open <page>` can name directly,
 * for "take me to the prompts page" asks that name no single resource. The
 * keys are the canonical names AGENTS.md documents; page names contain no
 * underscore, so they never collide with the id prefixes the fallback
 * resolves.
 *
 * Two tables, because the product has two kinds of page. A project page sits
 * under the project slug, so its address needs the slug in front of it and
 * tenancy holds by construction. An organization page sits at the top level,
 * beside the project pages rather than inside one: put the slug in front of
 * it and the router falls through to the project catch-all, which is a 404
 * wearing the project's own sidebar.
 *
 * Framework-free: the guided onboarding's route test reads both tables
 * against the route table, and must not pull the server's services in to do
 * it.
 *
 * @see specs/langy/langy-agent-driven-navigation.feature
 */
export const NAVIGATE_PROJECT_PAGES: Record<string, string> = {
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

export const NAVIGATE_ORGANIZATION_PAGES: Record<string, string> = {
  "governance-sources": "/governance/inventory?tab=sources",
};
