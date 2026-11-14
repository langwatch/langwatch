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

/** A person's own workspace inside an organization, as the admin drill-in link resolves it. */
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

/**
 * The drill-in lookup's answer. `disclosed: false` covers every miss (nobody, not a member, no
 * workspace yet) as one outcome, never a refusal, so the answer cannot be used to learn who
 * exists (ADR-146: a miss that means something other than not-found is a named union).
 */
const governanceActorWorkspaceLookupSchemaDefinition = z.discriminatedUnion("disclosed", [
  z.object({ disclosed: z.literal(true), workspace: governanceActorWorkspaceSchema }).strict(),
  z.object({ disclosed: z.literal(false) }).strict(),
]);
export interface GovernanceActorWorkspaceLookupSchema extends Named<
  typeof governanceActorWorkspaceLookupSchemaDefinition
> {}
export const governanceActorWorkspaceLookupSchema: GovernanceActorWorkspaceLookupSchema =
  governanceActorWorkspaceLookupSchemaDefinition;
export type GovernanceActorWorkspaceLookup = z.infer<typeof governanceActorWorkspaceLookupSchema>;
