/**
 * `organization.acceptInvite` is borrowed from a feature that has not split
 * yet (see `behavior/auth-api.ts`), so its answer is typed `unknown` on
 * purpose rather than reaching across the boundary for the real contract
 * type. This is the narrowing this family actually reads off it.
 */
import { z } from "zod";

export const acceptInviteResultSchema = z.object({
  invite: z.object({
    organization: z.object({ name: z.string() }),
  }),
  project: z.object({ slug: z.string() }).nullable().optional(),
});

export type AcceptInviteResult = z.infer<typeof acceptInviteResultSchema>;
