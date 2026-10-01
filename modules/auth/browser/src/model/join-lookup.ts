import type { JoinLookupDecision } from "@langwatch/identity-contract";
import { z } from "zod";

const joinOfferSchema = z.object({
  organizationId: z.string(),
  name: z.string(),
  colleagueCount: z.number(),
});

/** The join matcher's answer as the wire carries it (the contract types it `unknown`). */
export const joinLookupDecisionSchema: z.ZodType<JoinLookupDecision> = z.discriminatedUnion(
  "outcome",
  [
    z.object({ outcome: z.literal("none") }),
    z.object({ outcome: z.literal("ask"), organizations: z.array(joinOfferSchema) }),
    z.object({ outcome: z.literal("auto"), organization: joinOfferSchema }),
  ],
);
