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
  /**
   * A full snapshot of the agent's plan (todo list), mirrored to the live UI as
   * a checklist. Ephemeral on this buffer — the durable `plan_updated` event is
   * dispatched separately; the client prefers this typed snapshot over parsing
   * the raw `todowrite` tool part.
   */
  z.object({
    type: z.literal("plan"),
    items: z.array(z.object({ content: z.string(), status: z.string() })),
  }),
  /**
   * A tool call the agent ran, mirrored onto the live edge so the UI renders a
   * card as the tool starts and updates it when it returns. `phase:"start"`
   * carries the name + input; `phase:"end"` carries the result (`output`, a
   * string), `isError`, and — for a LangWatch CLI call — the result `digest`
   * the relay's envelope computed. The durable
   * `tool_call_started`/`tool_call_completed` events are dispatched separately.
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
   * The agent navigating the browser to a resource it surfaced. `href` is
   * ALWAYS platform-computed and already stripped to a same-app relative path —
   * never something the agent authored. LIVE-ONLY by design: never a durable
   * event, so reopening a past conversation never replays a navigation.
   */
  z.object({ type: z.literal("navigate"), href: z.string() }),
  /**
   * The agent asking the OPEN PAGE to carry out one typed action. `kind` names
   * an entry in a page's action manifest and `payload` has already passed that
   * entry's schema server-side before it was appended. LIVE-ONLY like
   * `navigate`, and `actionId` is the server-minted claim/result key, which
   * makes the whole round trip at-most-once.
   */
  z.object({
    type: z.literal("ui"),
    actionId: z.string(),
    kind: z.string(),
    payload: z.unknown(),
  }),
  z.object({ type: z.literal("end") }),
  z.object({ type: z.literal("error"), error: z.string() }),
]);

export type LangyStreamEntry = z.infer<typeof langyStreamEntrySchema>;
