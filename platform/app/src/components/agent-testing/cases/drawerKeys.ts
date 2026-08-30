/**
 * The drawer keys the Agent Testing scenarios surface uses.
 *
 * The keys live in this component-free module so a static importer (a header
 * band, a row-handler hook, the drawer registry) can name a drawer without
 * dragging its React module and Chakra dependencies into the caller's chunk.
 * The drawer components themselves re-export these keys so existing importers
 * are unaffected.
 */

export const CASE_EDITOR_DRAWER = "agentTestingCaseEditor" as const;

/** The drawer that connects the agent to be tested, opened on day zero. */
export const AGENT_TYPE_SELECTOR_DRAWER = "agentTypeSelector" as const;

/**
 * How wide the scenario editor drawer opens.
 *
 * The step is named in the drawer recipe (src/theme/recipes/drawer.ts). It sits
 * between Chakra's md and lg, because the editor holds a criteria list beside
 * its four questions and md cut that list short.
 */
export const CASE_EDITOR_DRAWER_SIZE = "2xl" as const;
