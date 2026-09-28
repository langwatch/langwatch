import { z } from "zod";

// The sink's CSP refuses eval. Set before any schema is built: Zod probes for
// eval as it constructs an object schema, and the probe logs a CSP violation.
z.config({ jitless: true });

/** Go encodes an empty slice as null; the inbox reads both as an empty list. */
const listOf = <Item extends z.ZodType>(item: Item) =>
  z
    .array(item)
    .nullable()
    .transform((items) => items ?? []);

export const summarySchema = z.object({
  id: z.string(),
  from: z.string(),
  to: listOf(z.string()),
  subject: z.string(),
  receivedAt: z.coerce.date(),
  sizeBytes: z.number(),
});
export type Summary = z.infer<typeof summarySchema>;

export const messageSchema = z.object({
  ...summarySchema.shape,
  headers: z
    .record(z.string(), z.string())
    .nullable()
    .transform((headers) => headers ?? {}),
  text: z.string(),
  html: z.string(),
  links: listOf(z.string()),
  attachments: listOf(
    z.object({ filename: z.string(), contentType: z.string(), sizeBytes: z.number() }),
  ),
});
export type Message = z.infer<typeof messageSchema>;

export const inboxSchema = z.object({
  stack: z.string(),
  smtpAddr: z.string(),
  baseUrl: z.string(),
  persistent: z.boolean(),
});
export type Inbox = z.infer<typeof inboxSchema>;

const messageListSchema = z.object({ messages: listOf(summarySchema) });

const REQUEST_TIMEOUT_MS = 5_000;
/** How long one live-arrival poll parks on the sink before the list is re-read anyway. */
export const WAIT_SECONDS = 10;

const request = async ({
  path,
  method = "GET",
  signal,
  timeoutMs = REQUEST_TIMEOUT_MS,
}: {
  path: string;
  method?: "GET" | "DELETE";
  signal?: AbortSignal;
  timeoutMs?: number;
}) => {
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetch(path, {
    method,
    cache: "no-store",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error(`Request failed (${response.status}). Please retry.`);
  return response;
};

const messagePath = ({ id }: { id: string }) => `/api/messages/${encodeURIComponent(id)}`;

export const mailApi = {
  inbox: async () => inboxSchema.parse(await (await request({ path: "/api/inbox" })).json()),
  list: async () =>
    messageListSchema.parse(await (await request({ path: "/api/messages" })).json()).messages,
  /** Undefined when the inbox no longer holds the message. */
  get: async ({ id }: { id: string }) => {
    const response = await fetch(messagePath({ id }), {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Request failed (${response.status}). Please retry.`);
    return messageSchema.parse(await response.json());
  },
  /** Parks until mail newer than `after` arrives (true) or the wait lapses (false). */
  waitForArrival: async ({ after, signal }: { after: string; signal: AbortSignal }) => {
    const query = new URLSearchParams({ after, timeout: `${WAIT_SECONDS}s` });
    const response = await request({
      path: `/api/messages/wait?${query.toString()}`,
      signal,
      timeoutMs: (WAIT_SECONDS + 5) * 1_000,
    });
    return response.status === 200;
  },
  clear: async () => {
    await request({ path: "/api/messages", method: "DELETE" });
  },
  remove: async ({ id }: { id: string }) => {
    await request({ path: messagePath({ id }), method: "DELETE" });
  },
  htmlPath: ({ id }: { id: string }) => `${messagePath({ id })}/html`,
  jsonPath: messagePath,
};
