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

/** Where the tab stands; the caller's own user is read off the session, never the input. */
export const readHintsInputSchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1).optional(),
});
export type ReadHintsInput = z.infer<typeof readHintsInputSchema>;

/** The tenants one stream listens on, and the abort that ends it. */
export type ReadHintsWatchInput = ReadHintsInput & { userId: string; signal?: AbortSignal };
