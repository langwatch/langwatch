// The pack's config with the filled example and four attacker turns.
import {
  EXAMPLE_AGENT,
  assertConfigFilled as assertFilled,
} from "../../../recipes/owasp-red-team/templates/typescript/owasp.config.ts";

export {
  MODEL,
  SET_ID,
  privilegedTools,
  type OwaspAgentConfig,
} from "../../../recipes/owasp-red-team/templates/typescript/owasp.config.ts";
export const AGENT = EXAMPLE_AGENT;
export const TOTAL_TURNS = 4;
export const assertConfigFilled = (agent = AGENT) => assertFilled(agent);
