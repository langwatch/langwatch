/**
 * What a governance write answers when the write itself is the whole answer.
 *
 * One flag, deliberately: an archive, an assignment or a policy change has no
 * fact to hand back that the caller did not already send, and answering the
 * changed row would invite a screen to read it instead of refetching.
 */
import { z } from "zod";

export const governanceWriteAcknowledgedSchema = z.object({ ok: z.boolean() }).strict();
export type GovernanceWriteAcknowledged = z.infer<typeof governanceWriteAcknowledgedSchema>;

/**
 * A person's own workspace inside an organization, as the admin drill-in link
 * resolves it. Null — never a refusal — covers every miss, so the answer can
 * not be used to learn who exists.
 */
export const governanceActorWorkspaceSchema = z
  .object({
    userId: z.string(),
    displayName: z.string(),
    teamId: z.string(),
    projectId: z.string(),
    projectSlug: z.string(),
  })
  .strict();
export type GovernanceActorWorkspace = z.infer<typeof governanceActorWorkspaceSchema>;
