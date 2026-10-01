import { z } from "zod";

/** The window a sign-up health reading answers for, in epoch milliseconds. */
export const opsSignUpHealthInputSchema = z.object({
  fromMs: z.number().int().nonnegative(),
  toMs: z.number().int().nonnegative(),
});
export type OpsSignUpHealthInput = z.infer<typeof opsSignUpHealthInputSchema>;

/** How many organizations founded in the window nobody meant to found (D12). */
export const signUpHealthSchema = z.object({
  organizationsFounded: z.number().int(),
  /** Founded ones whose founder joined another organization within thirty days. */
  orphanedOrganizations: z.number().int(),
  /** Orphaned as a share of founded, in [0, 1]; zero when nothing was founded. */
  orphanedRate: z.number(),
  fromMs: z.number(),
  toMs: z.number(),
});
export type SignUpHealth = z.infer<typeof signUpHealthSchema>;
