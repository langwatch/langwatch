import { SimFetchError, simFetch } from "@langwatch/sim-console";
import type { Instant } from "@langwatch/time";
import { z } from "zod";

export const modes = ["send", "load", "fuzz"] as const;
export type RunMode = (typeof modes)[number];

export const STATE_TONE = { running: "brand", done: "ok", stopped: "warn" } as const;

export const encodings = ["protobuf", "json"] as const;
export type Encoding = (typeof encodings)[number];

export const latencySchema = z.object({
  samples: z.number(),
  p50: z.number(),
  p90: z.number(),
  p99: z.number(),
  max: z.number(),
});

export const runSchema = z.object({
  id: z.string(),
  mode: z.enum(modes),
  preset: z.string(),
  seed: z.number(),
  endpoint: z.string(),
  encoding: z.string(),
  gzip: z.boolean(),
  state: z.enum(["running", "done", "stopped"]),
  startedAt: z.coerce.date(),
  finishedAt: z.coerce.date().optional(),
  targetRate: z.number().optional(),
  sent: z.number(),
  acked: z.number(),
  refused: z.number(),
  failed: z.number(),
  retried: z.number(),
  late: z.number(),
  lastError: z.string().optional(),
  mutations: z
    .array(z.object({ id: z.string(), status: z.number(), error: z.string().optional() }))
    .optional(),
  /** Every attempt's status, retries included, keyed by the status as a string. */
  answers: z.record(z.string(), z.number()).optional(),
  retryAfterSeen: z.number().optional(),
  lastRetryAfter: z.string().optional(),
  latency: latencySchema.optional(),
});
export type Run = z.infer<typeof runSchema>;

export const statusSchema = z.object({
  stack: z.string(),
  endpoint: z.string().optional(),
  keySource: z.string().optional(),
  keyHint: z.string().optional(),
  project: z.string().optional(),
  presets: z.array(z.string()),
  run: runSchema.optional(),
  recent: z
    .array(runSchema)
    .nullable()
    .transform((recent) => recent ?? []),
});
export type TelemetryStatus = z.infer<typeof statusSchema>;

export const runRequestSchema = z.object({
  mode: z.enum(modes),
  preset: z.string(),
  seed: z.number(),
  batches: z.number().optional(),
  budget: z.number().optional(),
  rate: z.number().optional(),
  duration: z.string().optional(),
});
export type RunRequest = z.infer<typeof runRequestSchema>;

/** One request outside any run: a pasted body, else a recorded fixture, else a preset. */
export const sendOneRequestSchema = z.object({
  preset: z.string().optional(),
  fixture: z.string().optional(),
  body: z.string().optional(),
  seed: z.number().optional(),
  encoding: z.enum(encodings),
  noGzip: z.boolean().optional(),
});
export type SendOneRequest = z.infer<typeof sendOneRequestSchema>;

export const sendOneAnswerSchema = z.object({
  url: z.string(),
  signal: z.string(),
  encoding: z.string(),
  gzip: z.boolean(),
  bytes: z.number(),
  status: z.number(),
  retryAfter: z.string().optional(),
  contentType: z.string().optional(),
  body: z.string().optional(),
  latencyMs: z.number(),
  error: z.string().optional(),
});
export type SendOneAnswer = z.infer<typeof sendOneAnswerSchema>;

export const fixtureSchema = z.object({
  name: z.string(),
  kind: z.enum(["preset", "recorded"]),
  signal: z.string(),
  service: z.string().optional(),
  family: z.string().optional(),
  bytes: z.number().optional(),
});
export type Fixture = z.infer<typeof fixtureSchema>;

export const fixtureBodySchema = z.object({ ...fixtureSchema.shape, body: z.unknown() });

const refusalSchema = z.object({ error: z.string() });

const refusalOf = async ({ response, fallback }: { response: Response; fallback: string }) => {
  const parsed = refusalSchema.safeParse(await response.json().catch(() => undefined));
  return parsed.success ? parsed.data.error : fallback;
};

const post = async <T>({
  path,
  body,
  schema,
  fallback,
}: {
  path: string;
  body: unknown;
  schema: z.ZodType<T>;
  fallback: string;
}) => {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new SimFetchError({
      status: response.status,
      message: await refusalOf({ response, fallback }),
    });
  }
  return schema.parse(await response.json());
};

export const fetchStatus = () => simFetch({ path: "/_sim/api/status", schema: statusSchema });

export const fetchRun = ({ id }: { id: string }) =>
  simFetch({ path: `/_sim/api/runs/${encodeURIComponent(id)}`, schema: runSchema });

export const fetchFixtures = () =>
  simFetch({
    path: "/_sim/api/fixtures",
    schema: z
      .object({ fixtures: fixtureSchema.array().nullable() })
      .transform((body) => body.fixtures ?? []),
  });

/** Fixture names keep their slash: a recording is `<family>/<name>`. */
export const fetchFixture = ({ name, seed }: { name: string; seed: number }) =>
  simFetch({
    path: `/_sim/api/fixtures/${name.split("/").map(encodeURIComponent).join("/")}?seed=${seed}`,
    schema: fixtureBodySchema,
  });

/** A send run answers once it is done; load and fuzz answer at once and run on. */
export const startRun = ({ request }: { request: RunRequest }) =>
  post({
    path: "/_sim/api/runs",
    body: runRequestSchema.parse(request),
    schema: runSchema,
    fallback: "Starting the run failed.",
  });

/** The sim answers 200 whatever the door said; a refusal means it could not build the request. */
export const sendOne = ({ request }: { request: SendOneRequest }) =>
  post({
    path: "/_sim/api/send-one",
    body: sendOneRequestSchema.parse(request),
    schema: sendOneAnswerSchema,
    fallback: "Sending failed.",
  });

export const stopRun = async () => {
  const response = await fetch("/_sim/api/runs/current", { method: "DELETE" });
  if (!response.ok) {
    throw new SimFetchError({
      status: response.status,
      message: await refusalOf({ response, fallback: "Stopping the run failed." }),
    });
  }
};

/** Seconds from start to finish, or to `now` while it runs. */
export const elapsedSeconds = ({ run, now }: { run: Run; now: Instant }) =>
  Math.max(
    0,
    ((run.finishedAt?.getTime() ?? now.epochMilliseconds) - run.startedAt.getTime()) / 1000,
  );

/** Batches a second actually sent, over the run's elapsed time. */
export const sentRate = ({ run, now }: { run: Run; now: Instant }) => {
  const seconds = elapsedSeconds({ run, now });
  return seconds === 0 ? 0 : run.sent / seconds;
};

/** What the OTLP door means by the statuses a sender most needs to tell apart. */
export const statusMeaning: Record<string, string> = {
  "200": "accepted",
  "400": "malformed body",
  "401": "no or wrong key",
  "403": "key not allowed",
  "413": "body too large",
  "415": "unsupported content type",
  "429": "rate limited",
  "500": "server error",
  "502": "bad gateway",
  "503": "unavailable",
  "504": "gateway timeout",
};
