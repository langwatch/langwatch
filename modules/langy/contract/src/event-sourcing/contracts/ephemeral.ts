import type { Named } from "@langwatch/module";
import { z } from "zod";

import { LANGY_EPHEMERAL_SIGNAL_TYPES } from "../../constants.ts";

/**
 * Live-transport-only signals: status/progress during turns, never persisted
 * to event_log/fold/projection. Liveness via Redis heartbeat recency. See
 * ADR-046.
 */

const langyStatusSignalSchemaDefinition = z.object({
  type: z.literal(LANGY_EPHEMERAL_SIGNAL_TYPES.STATUS_REPORTED),
  conversationId: z.string(),
  turnId: z.string().optional(),
  status: z.string(),
  occurredAt: z.number(),
});
export interface LangyStatusSignalSchema extends Named<typeof langyStatusSignalSchemaDefinition> {}
export const langyStatusSignalSchema: LangyStatusSignalSchema = langyStatusSignalSchemaDefinition;
export type LangyStatusSignal = z.infer<typeof langyStatusSignalSchema>;

const langyProgressSignalSchemaDefinition = z.object({
  type: z.literal(LANGY_EPHEMERAL_SIGNAL_TYPES.PROGRESS_REPORTED),
  conversationId: z.string(),
  turnId: z.string().optional(),
  message: z.string().optional(),
  progress: z.number().optional(),
  occurredAt: z.number(),
});
export interface LangyProgressSignalSchema extends Named<
  typeof langyProgressSignalSchemaDefinition
> {}
export const langyProgressSignalSchema: LangyProgressSignalSchema =
  langyProgressSignalSchemaDefinition;
export type LangyProgressSignal = z.infer<typeof langyProgressSignalSchema>;

const langyEphemeralSignalSchemaDefinition = z.discriminatedUnion("type", [
  langyStatusSignalSchema,
  langyProgressSignalSchema,
]);
export interface LangyEphemeralSignalSchema extends Named<
  typeof langyEphemeralSignalSchemaDefinition
> {}
export const langyEphemeralSignalSchema: LangyEphemeralSignalSchema =
  langyEphemeralSignalSchemaDefinition;
export type LangyEphemeralSignal = z.infer<typeof langyEphemeralSignalSchema>;

/**
 * Publishes an ephemeral signal to the live transport (per-turn Redis
 * buffer). The seam the pipeline declares so it never depends on the
 * transport; a test can hand a turn's `ephemeral` dep a fake instead.
 */
export interface LangyEphemeralPublisher {
  publish(tenantId: string, signal: LangyEphemeralSignal): Promise<void>;
}
