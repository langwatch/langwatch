import type { RouterOutputs } from "~/utils/api";

/** The pull request detail read, as the tRPC procedure defines it. */
export type DetailPayload = RouterOutputs["codingAgents"]["pullRequestDetail"];

/** The placeholder for a value a row does not have. */
export const MISSING_VALUE = "—";
