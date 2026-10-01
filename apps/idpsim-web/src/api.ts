import { z } from "zod";

/** Go encodes an empty slice as null; the console reads both as an empty list. */
const listOf = <Item extends z.ZodType>(item: Item) =>
  z
    .array(item)
    .nullable()
    .transform((items) => items ?? []);

export const tenantSummarySchema = z.object({
  id: z.number(),
  domain: z.string(),
  baseUrl: z.string(),
  users: z.number(),
  applications: z.number(),
});
export type TenantSummary = z.infer<typeof tenantSummarySchema>;

export const indexSchema = z.object({
  baseUrl: z.string(),
  dnsAddr: z.string(),
  tenants: listOf(tenantSummarySchema),
});
export type IndexView = z.infer<typeof indexSchema>;

export const applicationSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string(),
  name: z.string(),
  redirectUris: listOf(z.string()),
  entityId: z.string().optional(),
  acsUrl: z.string().optional(),
});
export type Application = z.infer<typeof applicationSchema>;

export const userSchema = z.object({
  id: z.string(),
  userName: z.string(),
  email: z.string(),
  givenName: z.string(),
  familyName: z.string(),
  active: z.boolean(),
  groups: listOf(z.string()).optional(),
});
export type User = z.infer<typeof userSchema>;

export const recordSchema = z.object({
  name: z.string(),
  value: z.string(),
  verifies: z.boolean(),
});
export type PublishedRecord = z.infer<typeof recordSchema>;

export const outcomeSchema = z.object({
  kind: z.string(),
  at: z.string(),
  summary: z.string(),
  users: listOf(z.string()).optional(),
  groups: listOf(z.string()).optional(),
  failures: listOf(z.string()).optional(),
  refused: z.boolean().optional(),
});
export type ProvisioningOutcome = z.infer<typeof outcomeSchema>;

export const scaleSchema = z.object({ users: z.number(), groups: z.number(), last: z.string() });
export type Scale = z.infer<typeof scaleSchema>;

export const tenantSchema = z.object({
  id: z.number(),
  domain: z.string(),
  baseUrl: z.string(),
  rootUrl: z.string(),
  dnsAddr: z.string(),
  scimToken: z.string(),
  saml: z.object({
    signInUrl: z.string(),
    entityId: z.string(),
    metadataUrl: z.string(),
    certificate: z.string(),
  }),
  applications: listOf(applicationSchema),
  users: listOf(userSchema),
  records: listOf(recordSchema),
  provisioning: z.object({ configured: z.boolean(), baseUrl: z.string(), token: z.string() }),
  lastProvisioning: outcomeSchema.nullable(),
  scale: scaleSchema,
});
export type TenantView = z.infer<typeof tenantSchema>;

export const refusalSchema = z.object({ title: z.string(), detail: z.string(), hint: z.string() });
export type Refusal = z.infer<typeof refusalSchema>;

export const signInSchema = z.object({
  tenantId: z.number(),
  domain: z.string(),
  refusal: refusalSchema.nullable(),
  users: listOf(z.object({ name: z.string(), email: z.string(), href: z.string() })),
});
export type SignInView = z.infer<typeof signInSchema>;

export const activitySchema = z.object({
  events: listOf(
    z.object({
      at: z.string(),
      kind: z.string(),
      outcome: z.string(),
      client: z.string().optional(),
      subject: z.string().optional(),
      detail: z.string(),
    }),
  ),
});
export type ActivityEvent = z.infer<typeof activitySchema>["events"][number];

const REQUEST_TIMEOUT_MS = 10_000;

/** What a request came back as: the parsed body, or the refusal to show. */
export type Answer<Data> = { ok: true; data: Data } | { ok: false; refusal: Refusal };

const unreadable = ({ status }: { status: number }): Refusal => ({
  title: `The simulator answered ${status}`,
  detail: "The answer was not one this console knows how to read.",
  hint: "Check the simulator's log, then reload the page.",
});

/**
 * One request to the simulator. A 4xx carries a refusal (title, detail,
 * hint) to show as it is; anything else unexpected becomes one.
 */
export const request = async <Data>({
  path,
  schema,
  method = "GET",
  body,
  signal,
}: {
  path: string;
  schema: z.ZodType<Data>;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}): Promise<Answer<Data>> => {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      cache: "no-store",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
    });
  } catch (error) {
    return {
      ok: false,
      refusal: {
        title: "The simulator did not answer",
        detail: error instanceof Error ? error.message : String(error),
        hint: "Is idpsim still running? `haven status` says, and `haven logs idp` says why not.",
      },
    };
  }
  const text = await response.text();
  const json: unknown = text === "" ? null : safeParse({ text });
  if (!response.ok) {
    const refusal = refusalSchema.safeParse(json);
    return {
      ok: false,
      refusal: refusal.success ? refusal.data : unreadable({ status: response.status }),
    };
  }
  const parsed = schema.safeParse(json);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, refusal: unreadable({ status: response.status }) };
};

const safeParse = ({ text }: { text: string }): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** An act with nothing to read back: a removal answers 204. */
export const emptySchema = z.unknown();

export const tenantPath = ({ id }: { id: number }) => `/api/t/${id}`;
