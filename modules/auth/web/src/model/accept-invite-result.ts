/** Narrows `organization.acceptInvite`, borrowed as `unknown` until it splits. */
import { z } from "zod";

export const acceptInviteResultSchema = z.object({
  invite: z.object({
    organization: z.object({ name: z.string() }),
  }),
  project: z.object({ slug: z.string() }).nullable().optional(),
});

export type AcceptInviteResult = z.infer<typeof acceptInviteResultSchema>;
