/**
 * Read hints: "the read at this path changed for a tenant you can see", relayed to the focused
 * tab (record §10, "Server events say when a read is stale").
 * Spec: packages/api/specs/read-hints.feature.
 */
import { z } from "zod";

/** The tenant broadcast member hints travel on. */
export const READ_INVALIDATED_BROADCAST_EVENT_TYPE = "read_invalidated" as const;

/** One hint: a procedure path, never data. */
export const readHintSchema = z.object({ path: z.string().min(1) });
export type ReadHint = z.infer<typeof readHintSchema>;

/** Where an organisation-level tab stands; the caller's own user is read off the session. */
export const organizationReadHintsInputSchema = z.object({
  organizationId: z.string().min(1),
});
export type OrganizationReadHintsInput = z.infer<typeof organizationReadHintsInputSchema>;

/** Where a project-level tab stands; the lineage guard refuses a foreign project. */
export const projectReadHintsInputSchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
});
export type ProjectReadHintsInput = z.infer<typeof projectReadHintsInputSchema>;

/** The tenants one stream listens on, and the portable abort that ends it. */
export type ReadHintsWatchInput = OrganizationReadHintsInput & {
  userId: string;
  projectId?: string;
  signal?: unknown;
};
