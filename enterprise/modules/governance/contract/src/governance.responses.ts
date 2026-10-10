import type { Named } from "@langwatch/module";
/**
 * What a governance write answers when the write itself is the whole
 * answer — one flag, deliberately, so a screen refetches instead of trusting
 * a returned row that invites staleness.
 */
import { z } from "zod";

const governanceWriteAcknowledgedSchemaDefinition = z.object({ ok: z.boolean() }).strict();
export interface GovernanceWriteAcknowledgedSchema extends Named<
  typeof governanceWriteAcknowledgedSchemaDefinition
> {}
export const governanceWriteAcknowledgedSchema: GovernanceWriteAcknowledgedSchema =
  governanceWriteAcknowledgedSchemaDefinition;
export type GovernanceWriteAcknowledged = z.infer<typeof governanceWriteAcknowledgedSchema>;

/**
 * A person's own workspace inside an organization, as the admin drill-in link
 * resolves it. Null — never a refusal — covers every miss, so the answer can
 * not be used to learn who exists.
 */
const governanceActorWorkspaceSchemaDefinition = z
  .object({
    userId: z.string(),
    displayName: z.string(),
    teamId: z.string(),
    projectId: z.string(),
    projectSlug: z.string(),
  })
  .strict();
export interface GovernanceActorWorkspaceSchema extends Named<
  typeof governanceActorWorkspaceSchemaDefinition
> {}
export const governanceActorWorkspaceSchema: GovernanceActorWorkspaceSchema =
  governanceActorWorkspaceSchemaDefinition;
export type GovernanceActorWorkspace = z.infer<typeof governanceActorWorkspaceSchema>;
