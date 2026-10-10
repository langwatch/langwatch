import type { Named } from "@langwatch/module";
/**
 * Read hints: "the read at this path changed for a tenant you can see", relayed to the focused
 * tab (record §10, "Server events say when a read is stale").
 * Spec: packages/api/specs/read-hints.feature.
 */
import { z } from "zod";

/** The tenant broadcast member hints travel on. */
export const READ_INVALIDATED_BROADCAST_EVENT_TYPE = "read_invalidated" as const;

/** One hint: a procedure path, never data. */
const readHintSchemaDefinition = z.object({ path: z.string().min(1) });
export interface ReadHintSchema extends Named<typeof readHintSchemaDefinition> {}
export const readHintSchema: ReadHintSchema = readHintSchemaDefinition;
export type ReadHint = z.infer<typeof readHintSchema>;

/** Where an organisation-level tab stands; the caller's own user is read off the session. */
const organizationReadHintsInputSchemaDefinition = z.object({
  organizationId: z.string().min(1),
});
export interface OrganizationReadHintsInputSchema extends Named<
  typeof organizationReadHintsInputSchemaDefinition
> {}
export const organizationReadHintsInputSchema: OrganizationReadHintsInputSchema =
  organizationReadHintsInputSchemaDefinition;
export type OrganizationReadHintsInput = z.infer<typeof organizationReadHintsInputSchema>;

/** Where a project-level tab stands; the lineage guard refuses a foreign project. */
const projectReadHintsInputSchemaDefinition = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
});
export interface ProjectReadHintsInputSchema extends Named<
  typeof projectReadHintsInputSchemaDefinition
> {}
export const projectReadHintsInputSchema: ProjectReadHintsInputSchema =
  projectReadHintsInputSchemaDefinition;
export type ProjectReadHintsInput = z.infer<typeof projectReadHintsInputSchema>;

/** The platform upgrade stream needs no tenant: only its portable abort (round 8, U2-LIVE). */
export type UpgradeReadHintsWatchInput = { signal?: unknown };

/** The tenants one stream listens on, and the portable abort that ends it. */
export type ReadHintsWatchInput = OrganizationReadHintsInput & {
  userId: string;
  projectId?: string;
  signal?: unknown;
};
