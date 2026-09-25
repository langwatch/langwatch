import { z } from "zod";

export const agentsListingRefusalCauseSchema = z.enum(["access", "unreachable", "incomplete"]);
export type AgentsListingRefusalCause = z.infer<typeof agentsListingRefusalCauseSchema>;

export const agentsListingOutcomeSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("listed") }),
  z.object({ outcome: z.literal("refused"), cause: agentsListingRefusalCauseSchema }),
]);
export type AgentsListingOutcome = z.infer<typeof agentsListingOutcomeSchema>;
