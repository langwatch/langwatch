import { SimFetchError, simFetch } from "@langwatch/sim-console";
import { z } from "zod";

/** Go encodes an empty slice as null; the console reads both as an empty list. */
const listOf = <Item extends z.ZodType>(item: Item) =>
  z
    .array(item)
    .nullable()
    .transform((items) => items ?? []);

export const callSchema = z.object({
  id: z.string(),
  at: z.coerce.date(),
  function: z.string(),
  mode: z.enum(["invoke", "stream"]),
  method: z.string(),
  path: z.string(),
  status: z.number(),
  functionError: z.string().optional(),
  durationMs: z.number(),
  error: z.string().optional(),
  request: z.string().optional(),
  response: z.string().optional(),
});
export type Call = z.infer<typeof callSchema>;

export const infoSchema = z.object({
  stack: z.string(),
  target: z.string(),
  capacity: z.number(),
  functions: listOf(z.string()),
  forcedErrors: listOf(z.string()),
  settings: z.object({ forcedError: z.string() }),
});

const callsSchema = z.object({ calls: listOf(callSchema) });

export const fetchInfo = () => simFetch({ path: "/_sim/api/info", schema: infoSchema });

export const fetchCalls = async () =>
  (await simFetch({ path: "/_sim/api/calls", schema: callsSchema })).calls;

/** One invocation with its request and response bodies. */
export const fetchCall = (id: string) =>
  simFetch({ path: `/_sim/api/calls/${encodeURIComponent(id)}`, schema: callSchema });

const send = async ({ method, path, body }: { method: string; path: string; body?: unknown }) => {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.ok) return;
  throw new SimFetchError({
    status: response.status,
    message: `${method} ${path} failed (${response.status}).`,
  });
};

/** Forgets every call; lambdasim answers 204. */
export const clearCalls = () => send({ method: "DELETE", path: "/_sim/api/calls" });

/** Forces every invoke to fail as the named kind; "" lets them through. */
export const setForcedError = (forcedError: string) =>
  send({ method: "PUT", path: "/_sim/api/settings", body: { forcedError } });
