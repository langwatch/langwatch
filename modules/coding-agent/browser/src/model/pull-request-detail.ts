import type { CodingAgentPullRequestDetail } from "@langwatch/coding-agent-contract";

/** The pull request detail read, as the coding-agent contract defines it. */
export type DetailPayload = CodingAgentPullRequestDetail;

/** What a model line reads when a session ran the model without per-model figures. */
export const MODEL_FIGURES_NOT_KNOWN = "Not known";

/** Why: the totals count that session, but its share of this model cannot be split out. */
export const MODEL_FIGURES_NOT_KNOWN_REASON =
  "A session ran this model without recording per-model figures, so its tokens, cost and AI units count in the pull request totals but cannot be split out by model.";
