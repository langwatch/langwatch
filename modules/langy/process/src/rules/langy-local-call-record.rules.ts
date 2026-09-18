/**
 * What the platform keeps about one local tool call while it is in flight, and what one pod
 * tells another about a conversation's folder. Shape only: the dispatcher owns the transitions.
 */
import { z } from "zod";
import type { SessionStateStore } from "@langwatch/redis-client/session-state";
import type { LangyLocalPresence } from "../repositories/langy-local-presence.repository.ts";
import type { LangyTokenBuffer } from "../repositories/langy-token-buffer.repository.ts";
import {
  CALL_STATES,
  bashOutputSchema,
  localCallErrorSchema,
  localToolCallSchema,
} from "@langwatch/langy-contract";

/** What the platform keeps about one call while it is in flight. */
export const storedLocalCallSchema = z
  .object({
    callId: z.string(),
    projectId: z.string(),
    conversationId: z.string(),
    turnId: z.string(),
    /** The worker's own tool call, so the card renders where the work is. */
    toolCallId: z.string().optional(),
    state: z.enum(CALL_STATES),
    createdAt: z.number(),
    deadlineAt: z.number(),
    /**
     * The whole time the command may run, so a call released from a permission
     * card starts its limit again. Absent on records written before the
     * dispatcher kept it, which read as a deadline that never moves.
     */
    timeoutMs: z.number().optional(),
    /** The permission card this call is waiting on, while it waits. */
    waitId: z.string().optional(),
    ok: z.boolean().optional(),
    text: z.string().optional(),
    output: bashOutputSchema.optional(),
    error: localCallErrorSchema.optional(),
  })
  .and(localToolCallSchema);
export type StoredLocalCall = z.infer<typeof storedLocalCallSchema>;

/** What one pod tells another about a conversation's folder. */
export const workspaceNudgeSchema = z.union([
  z.object({ call: z.string() }),
  z.object({ cancel: z.string() }),
  z.object({
    permission: z.object({
      callId: z.string(),
      decision: z.enum(["allow_once", "allow_pattern", "deny", "expired"]),
    }),
  }),
  z.object({ policy: z.object({ skipPermissions: z.boolean() }) }),
  z.object({ disconnect: z.object({ reason: z.string() }) }),
]);
export type WorkspaceNudge = z.infer<typeof workspaceNudgeSchema>;

/**
 * The live edge of the turn a call belongs to: the liveness key that says the
 * turn is still being worked on, and the activity line the panel reads.
 */
export type LocalCallBuffer = Pick<LangyTokenBuffer, "appendStatus" | "heartbeat">;

export interface LocalCallDispatcherOptions {
  store: SessionStateStore;
  presence: LangyLocalPresence;
  buffer?: LocalCallBuffer;
  now?: () => number;
  /** Test knob: how long a first call waits for the folder to appear. */
  offlineWaitMs?: number;
  pollIntervalMs?: number;
}
