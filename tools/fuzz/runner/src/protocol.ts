import { z } from "zod";

/**
 * planSchema is plan.json, the file the Go orchestrator writes (tools/fuzz/README.md). The
 * fields after `credential` are optional extras a hand-written plan may add.
 */
export const planSchema = z.object({
  runId: z.string().optional(),
  url: z.string().min(1),
  seed: z.number().int().default(1),
  workers: z.number().int().positive().default(16),
  durationMs: z.number().int().nonnegative().default(0),
  actionsPerRoute: z.number().int().positive().default(40),
  /** reloadEvery: every Nth visit a lane loads the page afresh; the others navigate in-app. */
  reloadEvery: z.number().int().positive().default(5),
  only: z.string().optional(),
  credential: z.object({
    email: z.string(),
    password: z.string(),
    fallbackEmails: z.array(z.string()).nullish(),
  }),
  /** slug is the project's address; absent, the monkey reads it from where `/` lands. */
  slug: z.string().optional(),
  /** passes are how many times the route list is walked; absent, one, or until durationMs. */
  passes: z.number().int().positive().optional(),
  actionCapMillis: z.number().int().positive().default(20_000),
  viewport: z
    .object({ width: z.number().int(), height: z.number().int() })
    .default({ width: 1440, height: 900 }),
  settle: z
    .object({ quietMillis: z.number().int(), deadlineMillis: z.number().int() })
    .default({ quietMillis: 300, deadlineMillis: 8000 }),
  /** routes are router patterns; absent, every route the UI's route table registers. */
  routes: z.array(z.string()).nullish(),
  fixtures: z.record(z.string(), z.string()).nullish(),
  /** avoid are extra control-text patterns (regex source) the monkey never touches. */
  avoid: z.array(z.string()).nullish(),
});
export type FuzzPlan = z.infer<typeof planSchema>;

export const ORACLES = [
  "console-error",
  "page-error",
  "network-5xx",
  "network-4xx",
  "blank",
  "error-boundary",
  "nav-404",
  "hang",
] as const;
export type Oracle = (typeof ORACLES)[number];

/** findingSchema is one line of findings.jsonl, as tools/fuzz/README.md documents it. */
export const findingSchema = z.object({
  oracle: z.enum(ORACLES),
  finding: z.literal(true),
  route: z.string(),
  signature: z.string(),
  message: z.string(),
  trail: z.array(z.string()),
  evidence: z.object({
    screenshot: z.string().optional(),
    url: z.string(),
    console: z.array(z.string()),
    requests: z.array(z.string()),
  }),
  capturedAt: z.string(),
  /** seed and visit replay the trail: the same seed on the same route makes the same choices. */
  seed: z.number().int(),
  visit: z.number().int(),
  /** navigation says how the visit reached its route: a full page load or an in-app move. */
  navigation: z.enum(["reload", "in-app"]),
});
export type Navigation = Finding["navigation"];
export type Finding = z.infer<typeof findingSchema>;

/** runCompleteSchema is the last line of the file. */
export const runCompleteSchema = z.object({
  kind: z.literal("run-complete"),
  total: z.number().int(),
  counts: z.record(z.string(), z.number().int()),
  routesExercised: z.number().int(),
  routesTotal: z.number().int(),
  capturedAt: z.string(),
});
export type RunComplete = z.infer<typeof runCompleteSchema>;

export const coverageSchema = z.object({
  routesTotal: z.number().int(),
  routesVisited: z.number().int(),
  routesSkipped: z.array(z.object({ route: z.string(), reason: z.string() })),
  visits: z.number().int(),
  actions: z.number().int(),
  moduleFailures: z.number().int(),
  reloads: z.number().int(),
  inAppVisits: z.number().int(),
  navigationFallbacks: z.number().int(),
  pathsSeen: z.array(z.string()),
  perRoute: z.record(
    z.string(),
    z.object({ visits: z.number().int(), actions: z.number().int(), findings: z.number().int() }),
  ),
  signInMillis: z.number().int(),
  walkMillis: z.number().int(),
});
export type Coverage = z.infer<typeof coverageSchema>;
