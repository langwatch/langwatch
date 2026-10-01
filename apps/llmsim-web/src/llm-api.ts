import { SimFetchError, simFetch } from "@langwatch/sim-console";
import { z } from "zod";

/** Go encodes an empty slice as null; the console reads both as an empty list. */
const listOf = <Item extends z.ZodType>(item: Item) =>
  z
    .array(item)
    .nullable()
    .transform((items) => items ?? []);

export const settingsSchema = z.object({ forcedError: z.number(), seed: z.string() });
export type Settings = z.infer<typeof settingsSchema>;

export const infoSchema = z.object({
  stack: z.string(),
  models: listOf(z.string()),
  capacity: z.number(),
  settings: settingsSchema,
});
export type Info = z.infer<typeof infoSchema>;

export const callSchema = z.object({
  id: z.string(),
  at: z.coerce.date(),
  path: z.string(),
  dialect: z.string(),
  model: z.string(),
  mode: z.string(),
  stream: z.boolean(),
  status: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  latencyMs: z.number(),
  error: z.string().optional(),
});
export type Call = z.infer<typeof callSchema>;

export const callDetailSchema = z.object({
  ...callSchema.shape,
  request: z.unknown().optional(),
  response: z
    .object({
      mode: z.string(),
      text: z.string(),
      calls: listOf(
        z.object({ id: z.string(), name: z.string(), arguments: z.string() }),
      ).optional(),
      finish: z.string(),
    })
    .optional(),
});
export type CallDetail = z.infer<typeof callDetailSchema>;

const callsSchema = z.object({ calls: listOf(callSchema) });

export const fetchInfo = () => simFetch({ path: "/_sim/api/info", schema: infoSchema });

export const fetchCalls = async () =>
  (await simFetch({ path: "/_sim/api/calls", schema: callsSchema })).calls;

export const fetchCall = ({ id }: { id: string }) =>
  simFetch({ path: `/_sim/api/calls/${encodeURIComponent(id)}`, schema: callDetailSchema });

/** The one write the console makes; simFetch only reads. */
export const saveSettings = async ({ settings }: { settings: Settings }) => {
  const response = await fetch("/_sim/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const refusal = z.object({ error: z.object({ message: z.string() }) }).safeParse(body);
    throw new SimFetchError({
      status: response.status,
      message: refusal.success ? refusal.data.error.message : `Saving failed (${response.status}).`,
    });
  }
  return settingsSchema.parse(body);
};
