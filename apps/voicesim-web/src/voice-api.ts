import { simFetch } from "@langwatch/sim-console";
import { z } from "zod";

/** Go encodes an empty slice as null; the console reads both as an empty list. */
const listOf = <Item extends z.ZodType>(item: Item) =>
  z
    .array(item)
    .nullable()
    .transform((items) => items ?? []);

export const turnSchema = z.object({
  index: z.number(),
  at: z.coerce.date(),
  callerText: z.string(),
  agentText: z.string(),
  callerFrames: z.number(),
  agentFrames: z.number(),
});
export type Turn = z.infer<typeof turnSchema>;

export const callEventSchema = z.object({
  at: z.coerce.date(),
  direction: z.enum(["in", "out"]),
  type: z.string(),
});
export type CallEvent = z.infer<typeof callEventSchema>;

export const callSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date().optional(),
  callerFrames: z.number(),
  agentFrames: z.number(),
  turns: listOf(turnSchema),
  events: listOf(callEventSchema),
  droppedEvents: z.number(),
});
export type Call = z.infer<typeof callSchema>;

export const statusSchema = z.object({
  stack: z.string(),
  calls: z.number(),
  elevenLabsBaseUrl: z.string(),
  openaiBaseUrl: z.string(),
});
export type Status = z.infer<typeof statusSchema>;

const callsSchema = z.object({ calls: listOf(callSchema) });

export const fetchStatus = () => simFetch({ path: "/_sim/api/status", schema: statusSchema });

export const fetchCalls = async () =>
  (await simFetch({ path: "/_sim/api/calls", schema: callsSchema })).calls;
