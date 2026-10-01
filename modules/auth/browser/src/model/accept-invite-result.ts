/** Narrows `invite.acceptInvite`'s answer to the fields the join toast and redirect read. */
import { z } from "zod";

export const acceptInviteResultSchema = z.object({
  invite: z.object({
    organization: z.object({ name: z.string() }),
  }),
  project: z.object({ slug: z.string() }).nullable().optional(),
});

export type AcceptInviteResult = z.infer<typeof acceptInviteResultSchema>;
