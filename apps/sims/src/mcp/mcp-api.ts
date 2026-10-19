import { SimFetchError, simFetch } from "@langwatch/sim-console";
import { z } from "zod";

export const flows = ["apikey", "oauth"] as const;
export type Flow = (typeof flows)[number];

export const transports = ["/mcp", "/sse", "both"] as const;
export type Transport = (typeof transports)[number];

export const clients = ["claude-code", "claude-desktop", "cursor"] as const;

export const connectModes = ["auto", "interactive"] as const;
export type ConnectMode = (typeof connectModes)[number];

export const STATE_TONE = {
  running: "brand",
  waiting: "warn",
  passed: "ok",
  failed: "error",
  stopped: "warn",
} as const;

export const runStates = ["running", "waiting", "passed", "failed", "stopped"] as const;
export type RunState = (typeof runStates)[number];

export const isActive = ({ state }: { state: RunState }) =>
  state === "running" || state === "waiting";

export const stepSchema = z.object({
  at: z.coerce.date(),
  kind: z.string(),
  flow: z.string().optional(),
  transport: z.string().optional(),
  method: z.string().optional(),
  url: z.string().optional(),
  status: z.number().optional(),
  latencyMs: z.number(),
  ok: z.boolean(),
  session: z.string().optional(),
  detail: z.string().optional(),
  error: z.string().optional(),
});
export type Step = z.infer<typeof stepSchema>;

export const checkSchema = z.object({
  name: z.string(),
  pass: z.boolean(),
  detail: z.string().optional(),
});
export type Check = z.infer<typeof checkSchema>;

export const latencySchema = z.object({
  samples: z.number(),
  p50: z.number(),
  p90: z.number(),
  p99: z.number(),
  max: z.number(),
});

export const loadSchema = z.object({
  clients: z.number(),
  sessions: z.number(),
  requests: z.number(),
  errors: z.number(),
  reinitialized: z.number(),
  refreshed: z.number(),
  retried: z.number(),
  answers: z.record(z.string(), z.number()).nullish(),
  latency: latencySchema.nullish(),
});
export type Load = z.infer<typeof loadSchema>;

const listOf = <T extends z.ZodType>(item: T) =>
  z
    .array(item)
    .nullish()
    .transform((list) => list ?? []);

export const runSchema = z.object({
  id: z.string(),
  scenario: z.string(),
  flow: z.string(),
  client: z.string(),
  endpoint: z.string(),
  transports: listOf(z.string()),
  state: z.enum(runStates),
  startedAt: z.coerce.date(),
  finishedAt: z.coerce.date().nullish(),
  durationMs: z.number(),
  steps: listOf(stepSchema),
  stepsDropped: z.number().optional(),
  checks: listOf(checkSchema),
  load: loadSchema.nullish(),
  authorizeUrl: z.string().optional(),
  error: z.string().optional(),
});
export type Run = z.infer<typeof runSchema>;

export const grantSchema = z.object({
  connected: z.boolean(),
  endpoint: z.string().optional(),
  clientId: z.string().optional(),
  projectId: z.string().optional(),
  accessHint: z.string().optional(),
  refreshHint: z.string().optional(),
  obtainedAt: z.coerce.date().nullish(),
  expiresAt: z.coerce.date().nullish(),
  lastRefreshAt: z.coerce.date().nullish(),
  refreshes: z.number(),
});
export type Grant = z.infer<typeof grantSchema>;

export const scenarioSchema = z.object({
  name: z.string(),
  summary: z.string(),
  flows: listOf(z.string()),
});
export type Scenario = z.infer<typeof scenarioSchema>;

export const statusSchema = z.object({
  stack: z.string(),
  endpoint: z.string().optional(),
  keySource: z.string().optional(),
  keyHint: z.string().optional(),
  projectId: z.string().optional(),
  callbackUrl: z.string(),
  autoApprove: z.string().optional(),
  oauth: grantSchema,
  scenarios: listOf(scenarioSchema),
  runs: listOf(runSchema),
});
export type McpStatus = z.infer<typeof statusSchema>;

export const runRequestSchema = z.object({
  scenario: z.string(),
  flow: z.enum(flows),
  client: z.string(),
  transport: z.enum(transports),
  tool: z.string().optional(),
  holdSeconds: z.number().optional(),
  idleSeconds: z.number().optional(),
  clients: z.number().optional(),
  duration: z.string().optional(),
});
export type RunRequest = z.infer<typeof runRequestSchema>;

export const connectRequestSchema = z.object({
  mode: z.enum(connectModes),
  cookie: z.string().optional(),
  projectId: z.string().optional(),
});
export type ConnectRequest = z.infer<typeof connectRequestSchema>;

/** An interactive connect answers within ten seconds; a hung sim must not leave a button busy. */
const SEND_TIMEOUT_MS = 15_000;

const refusalSchema = z.object({ error: z.string() });

const refusalOf = async ({ response, fallback }: { response: Response; fallback: string }) => {
  const parsed = refusalSchema.safeParse(await response.json().catch(() => undefined));
  return parsed.success ? parsed.data.error : fallback;
};

const send = async ({
  path,
  method,
  body,
  fallback,
}: {
  path: string;
  method: "POST" | "DELETE";
  body?: unknown;
  fallback: string;
}) => {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new SimFetchError({
      status: response.status,
      message: await refusalOf({ response, fallback }),
    });
  }
  return response;
};

export const fetchStatus = () => simFetch({ path: "/_sim/api/status", schema: statusSchema });

export const fetchRun = ({ id }: { id: string }) =>
  simFetch({ path: `/_sim/api/runs/${encodeURIComponent(id)}`, schema: runSchema });

/** The sim answers 202 at once; the run goes on in the sim. */
export const startRun = async ({ request }: { request: RunRequest }) => {
  const response = await send({
    path: "/_sim/api/runs",
    method: "POST",
    body: runRequestSchema.parse(request),
    fallback: "Starting the run failed.",
  });
  return runSchema.parse(await response.json());
};

export const connectOAuth = async ({ request }: { request: ConnectRequest }) => {
  const response = await send({
    path: "/_sim/api/oauth/connect",
    method: "POST",
    body: connectRequestSchema.parse(request),
    fallback: "Connecting OAuth failed.",
  });
  return runSchema.parse(await response.json());
};

export const stopRun = async ({ id }: { id: string }) => {
  await send({
    path: `/_sim/api/runs/${encodeURIComponent(id)}`,
    method: "DELETE",
    fallback: "Stopping the run failed.",
  });
};

export const clearRuns = async () => {
  await send({ path: "/_sim/api/runs", method: "DELETE", fallback: "Clearing the runs failed." });
};

export const forgetGrant = async () => {
  await send({
    path: "/_sim/api/oauth",
    method: "DELETE",
    fallback: "Forgetting the grant failed.",
  });
};

/** Whether a scenario can run on a flow, given whether the OAuth grant is held. */
export const scenarioBlock = ({
  scenario,
  flow,
  connected,
}: {
  scenario: Scenario;
  flow: Flow;
  connected: boolean;
}) => {
  if (!scenario.flows.includes(flow))
    return `${scenario.name} runs on the ${scenario.flows.join(" or ")} flow only`;
  if (flow === "oauth" && scenario.name !== "oauth-connect" && !connected) {
    return "Connect OAuth first (Setup)";
  }
  return "";
};

export const durationText = ({ ms }: { ms: number }) =>
  ms < 1_000 ? `${Math.round(ms)} ms` : `${(ms / 1_000).toFixed(1)} s`;
