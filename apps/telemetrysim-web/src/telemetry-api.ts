import { SimFetchError, simFetch } from "@langwatch/sim-console";
import type { Instant } from "@langwatch/time";
import { z } from "zod";

export const modes = ["send", "load", "fuzz"] as const;
export type RunMode = (typeof modes)[number];

export const runSchema = z.object({
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
});
export type Run = z.infer<typeof runSchema>;

export const statusSchema = z.object({
  stack: z.string(),
  endpoint: z.string().optional(),
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

const refusalSchema = z.object({ error: z.string() });

const refusalOf = async ({ response, fallback }: { response: Response; fallback: string }) => {
  const parsed = refusalSchema.safeParse(await response.json().catch(() => undefined));
  return parsed.success ? parsed.data.error : fallback;
};

export const fetchStatus = () => simFetch({ path: "/_sim/api/status", schema: statusSchema });

/** A send run answers once it is done; load and fuzz answer at once and run on. */
export const startRun = async ({ request }: { request: RunRequest }) => {
  const response = await fetch("/_sim/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(runRequestSchema.parse(request)),
  });
  if (!response.ok) {
    throw new SimFetchError({
      status: response.status,
      message: await refusalOf({ response, fallback: "Starting the run failed." }),
    });
  }
  return runSchema.parse(await response.json());
};

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
