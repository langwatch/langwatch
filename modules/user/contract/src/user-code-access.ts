import { z } from "zod";

/** How Langy reaches this person's code: "github" when they asked to be remembered, null to ask. */
export const userCodeAccessPreferenceSchema = z
  .object({ preference: z.literal("github").nullable() })
  .strict();
export type UserCodeAccessPreference = z.infer<typeof userCodeAccessPreferenceSchema>;
