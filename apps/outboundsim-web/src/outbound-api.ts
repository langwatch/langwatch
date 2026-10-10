import { SimFetchError, simFetch } from "@langwatch/sim-console";
import { z } from "zod";

export const channels = ["slack-webhook", "slack-api", "webhook", "sqs"] as const;
export const verdicts = ["valid", "invalid", "unchecked"] as const;
export type Channel = (typeof channels)[number];

export const channelLabel = {
  "slack-webhook": "Slack webhook",
  "slack-api": "Slack API",
  webhook: "Webhook",
  sqs: "SQS",
} as const satisfies Record<Channel, string>;

/** Go encodes a nil map or slice as null; the console reads both as empty. */
const orEmptyRecord = z
  .record(z.string(), z.unknown())
  .nullable()
  .transform((value) => value ?? ({} satisfies Record<string, unknown>));

export const recordSchema = z.object({
  id: z.string(),
  channel: z.enum(channels),
  target: z.string(),
  method: z.string(),
  headers: z
    .record(z.string(), z.string())
    .nullable()
    .transform((headers) => headers ?? ({} satisfies Record<string, string>)),
  body: z.string(),
  truncated: z.boolean().default(false),
  parsed: orEmptyRecord,
  eventId: z.string().optional(),
  deliveryId: z.string().optional(),
  attempt: z.number().optional(),
  testFire: z.boolean().optional(),
  signature: z.enum(verdicts).optional(),
  status: z.number(),
  faultId: z.string().optional(),
  dropped: z.boolean().default(false),
  latencyMs: z.number(),
  receivedAt: z.coerce.date(),
});
export type OutboundRecord = z.infer<typeof recordSchema>;

export const statusSchema = z.object({
  stack: z.string(),
  records: z.number(),
  baseUrl: z.string(),
});

const attemptSchema = z.object({
  id: z.string(),
  attempt: z.number(),
  status: z.number(),
  signature: z.enum(verdicts).optional(),
  faultId: z.string().optional(),
  dropped: z.boolean().default(false),
  latencyMs: z.number(),
  receivedAt: z.coerce.date(),
});
export type Attempt = z.infer<typeof attemptSchema>;

export const deliverySchema = z.object({
  eventId: z.string(),
  target: z.string(),
  attempts: attemptSchema
    .array()
    .nullable()
    .transform((attempts) => attempts ?? []),
});
export type Delivery = z.infer<typeof deliverySchema>;

export const faultSchema = z.object({
  id: z.string(),
  channel: z.enum(channels),
  target: z.string(),
  status: z.number(),
  body: z.string().optional(),
  retryAfter: z.number().optional(),
  latencyMs: z.number(),
  drop: z.boolean(),
  times: z.number().optional(),
});
export type Fault = z.infer<typeof faultSchema>;

export type FaultInput = Omit<Fault, "id">;

export const setupUrlSchema = z.object({
  label: z.string(),
  channel: z.enum(channels),
  url: z.string(),
  setting: z.string().optional(),
});
export type SetupUrl = z.infer<typeof setupUrlSchema>;

const list = <T extends z.ZodType>({ key, item }: { key: string; item: T }) =>
  z.object({ [key]: item.array().nullable() }).transform((body) => body[key] ?? []);

export const fetchStatus = () => simFetch({ path: "/_sim/api/status", schema: statusSchema });

export const fetchRecords = () =>
  simFetch({ path: "/_sim/api/records", schema: list({ key: "records", item: recordSchema }) });

export const fetchDeliveries = () =>
  simFetch({
    path: "/_sim/api/deliveries",
    schema: list({ key: "deliveries", item: deliverySchema }),
  });

export const fetchFaults = () =>
  simFetch({ path: "/_sim/api/faults", schema: list({ key: "faults", item: faultSchema }) });

export const fetchSetup = () =>
  simFetch({ path: "/_sim/api/setup", schema: list({ key: "urls", item: setupUrlSchema }) });

const refusalSchema = z.object({ error: z.string() });

const send = async ({ path, method, body }: { path: string; method: string; body?: unknown }) => {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.ok) return;
  const refusal = refusalSchema.safeParse(await response.json().catch(() => undefined));
  throw new SimFetchError({
    status: response.status,
    message: refusal.success ? refusal.data.error : `Request failed (${response.status}).`,
  });
};

export const clearRecords = () => send({ path: "/_sim/api/records", method: "DELETE" });

export const addFault = ({ fault }: { fault: FaultInput }) =>
  send({ path: "/_sim/api/faults", method: "POST", body: fault });

export const removeFault = ({ id }: { id: string }) =>
  send({ path: `/_sim/api/faults/${encodeURIComponent(id)}`, method: "DELETE" });

export const clearFaults = () => send({ path: "/_sim/api/faults", method: "DELETE" });
