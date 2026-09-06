/**
 * One entry on `langy.onTurnStream`, as both sides of the wire read it. THE TYPE IS THE WIRE,
 * and the wire has two ends: the worker's token buffer writes these, and the browser's chat
 * transport bridges them into the chunk stream `useChat` reads.
 */

import { z } from "zod";

import { cliResultDigestSchema } from "./cards/digest";
import { cliToolResultSchema } from "./cards/tool-result";

export const langyStreamEntrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("delta"), text: z.string() }),
  z.object({ type: z.literal("reasoning"), text: z.string() }),
  z.object({ type: z.literal("status"), status: z.string() }),
  z.object({
    type: z.literal("progress"),
    message: z.string().optional(),
    progress: z.number().optional(),
    current: z.number().optional(),
    total: z.number().optional(),
    batchItems: z.number().optional(),
    batchDurationMs: z.number().optional(),
  }),
  z.object({ type: z.literal("milestone"), kind: z.string(), detail: z.string().optional() }),
  /** Full plan snapshot, mirrored live. Ephemeral — the durable `plan_updated` event is separate. */
  z.object({
    type: z.literal("plan"),
    items: z.array(z.object({ content: z.string(), status: z.string() })),
  }),
  /**
   * A tool call, mirrored live. `phase:"start"` carries name+input;
   * `phase:"end"` carries `output`/`isError`/`digest`. Durable events are
   * dispatched separately.
   */
  z.object({
    type: z.literal("tool"),
    id: z.string(),
    name: z.string(),
    phase: z.enum(["start", "end"]),
    title: z.string().optional(),
    input: z.unknown().optional(),
    output: z.string().optional(),
    isError: z.boolean().optional(),
    digest: cliResultDigestSchema.optional(),
    result: cliToolResultSchema.optional(),
  }),
  /**
   * The agent navigating the browser. `href` is ALWAYS platform-computed,
   * never agent-authored. LIVE-ONLY: never a durable event, never replayed.
   */
  z.object({ type: z.literal("navigate"), href: z.string() }),
  /**
   * The agent asking the OPEN PAGE to run one typed action, `payload`
   * already schema-validated server-side. LIVE-ONLY; `actionId` makes the
   * round trip at-most-once.
   */
  z.object({
    type: z.literal("ui"),
    actionId: z.string(),
    kind: z.string(),
    payload: z.unknown(),
  }),
  /**
   * ADR-129. A card to answer mid-turn (permission or question). The durable
   * `user_wait_started` event is the source of truth; this is the fast-path
   * wake-up for the tab that sent the message.
   */
  z.object({
    type: z.literal("local_permission"),
    waitId: z.string(),
    callId: z.string(),
    toolCallId: z.string().optional(),
    summary: z.string(),
    pattern: z.string(),
    /** Every pattern one session grant covers, first one first. */
    patterns: z.array(z.string()),
    reason: z.string(),
    /** The seconds after which the command is stopped, when it has a limit. */
    timeoutSeconds: z.number().optional(),
    skipOffered: z.boolean(),
    workspaceName: z.string(),
    hostname: z.string(),
    status: z.enum(["pending", "answered", "expired", "cancelled"]),
    decision: z.string().optional(),
    /** Where the answer was given. Absent means the card in the panel. */
    source: z.enum(["panel", "terminal"]).optional(),
  }),
  z.object({
    type: z.literal("question"),
    waitId: z.string(),
    toolCallId: z.string().optional(),
    questions: z.unknown(),
    status: z.enum(["pending", "answered", "expired", "cancelled"]),
    answers: z.unknown().optional(),
  }),
  /**
   * The developer's folder came or went while the turn was running, so the chip and the code
   * access card change without a reload.
   */
  z.object({
    type: z.literal("local_workspace"),
    state: z.enum(["connected", "disconnected"]),
    name: z.string(),
    root: z.string(),
    hostname: z.string(),
    gitBranch: z.string().optional(),
  }),
  z.object({ type: z.literal("end") }),
  z.object({ type: z.literal("error"), error: z.string() }),
]);

export type LangyStreamEntry = z.infer<typeof langyStreamEntrySchema>;
