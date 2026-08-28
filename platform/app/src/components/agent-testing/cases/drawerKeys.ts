/**
 * The drawer keys the Agent Testing cases surface uses.
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
