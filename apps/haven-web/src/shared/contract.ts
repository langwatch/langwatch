import { z } from "zod";

/*
 * The daemon's JSON (tools/thuishaven/adapters/dashboard: hubapi.go,
 * stackhome.go, logs.go, actions.go). Every field is always present; Go's
 * tests pin the shapes and this file is the one place the console reads them.
 */

export const surfaceStatusSchema = z.enum(["live", "starting", "down", "not-selected"]);
export type SurfaceStatus = z.infer<typeof surfaceStatusSchema>;

export const surfaceSchema = z.object({
  name: z.string(),
  role: z.string(),
  hostname: z.string(),
  url: z.string(),
  port: z.number(),
  status: surfaceStatusSchema,
  hint: z.string(),
  fallback: z.boolean(),
});
export type Surface = z.infer<typeof surfaceSchema>;

const databaseSchema = z.object({ name: z.string(), port: z.number() });

export const factsSchema = z.object({
  branch: z.string(),
  worktreeDir: z.string(),
  layout: z.string(),
  baseline: z.boolean(),
  uptimeSeconds: z.number(),
  rssBytes: z.number(),
  heartbeatAt: z.string().nullable(),
  databases: z.object({
    postgres: databaseSchema,
    clickhouse: databaseSchema,
    redis: z.object({ db: z.number().nullable(), port: z.number() }),
  }),
});
export type Facts = z.infer<typeof factsSchema>;

export const logLineSchema = z.object({
  at: z.string(),
  service: z.string(),
  level: z.string(),
  text: z.string(),
});
export type CapturedLine = z.infer<typeof logLineSchema>;

export const laneErrorsSchema = z.object({
  lane: z.string(),
  logsUrl: z.string(),
  lines: z.array(logLineSchema),
});
export type LaneErrors = z.infer<typeof laneErrorsSchema>;

export const credentialsSchema = z.object({
  login: z.object({ email: z.string() }),
  mailAddress: z.string(),
  idpTenants: z.array(z.object({ id: z.string(), domain: z.string(), url: z.string() })),
  apiKey: z.object({ masked: z.string(), revealPath: z.string() }).nullable(),
});
export type Credentials = z.infer<typeof credentialsSchema>;

export const stackHomeSchema = z.object({
  slug: z.string(),
  registered: z.boolean(),
  live: z.boolean(),
  hubUrl: z.string(),
  homeUrl: z.string(),
  facts: factsSchema,
  surfaces: z.array(surfaceSchema),
  errors: z.array(laneErrorsSchema),
  credentials: credentialsSchema,
  actions: z.object({ canRestart: z.boolean(), canStart: z.boolean(), startDir: z.string() }),
});
export type StackHome = z.infer<typeof stackHomeSchema>;

export const notFoundSchema = z.object({ error: z.string(), slug: z.string(), hubUrl: z.string() });
export type NotFound = z.infer<typeof notFoundSchema>;

/** The stack's analyticssim activity: who is driving its app right now. */
export const hubAnalyticsSchema = z.object({
  total: z.number(),
  lastFiveMinutes: z.number(),
  distinctIds: z.number(),
  lastReceivedAt: z.string().nullable(),
  lastName: z.string(),
});
export type HubAnalytics = z.infer<typeof hubAnalyticsSchema>;

export const hubStackSchema = z.object({
  slug: z.string(),
  live: z.boolean(),
  homeUrl: z.string(),
  appUrl: z.string(),
  facts: factsSchema,
  surfaces: z.array(surfaceSchema),
  canRestart: z.boolean(),
  canDown: z.boolean(),
  canDestroy: z.boolean(),
  analytics: hubAnalyticsSchema.optional(),
});
export type HubStack = z.infer<typeof hubStackSchema>;

export const hubWorktreeSchema = z.object({
  name: z.string(),
  slug: z.string(),
  branch: z.string(),
  dir: z.string(),
  isPrimary: z.boolean(),
  isCurrent: z.boolean(),
  homeUrl: z.string(),
  canStart: z.boolean(),
});
export type HubWorktree = z.infer<typeof hubWorktreeSchema>;

export const hubEventSchema = z.object({
  at: z.string().nullable(),
  kind: z.string(),
  target: z.string(),
  reason: z.string(),
});
export type HubEvent = z.infer<typeof hubEventSchema>;

export const machineSchema = z.object({
  totalRamBytes: z.number(),
  devRssBytes: z.number(),
  stacksRssBytes: z.number(),
  serverRssBytes: z.record(z.string(), z.number()),
  agentRssBytes: z.number(),
  agentCount: z.number(),
  toolingRssBytes: z.number(),
  otherRssBytes: z.number(),
  pressure: z.string(),
});
export type Machine = z.infer<typeof machineSchema>;

export const hubSchema = z.object({
  shared: z.object({ hubUrl: z.string(), observabilityUrl: z.string(), telemetryUrl: z.string() }),
  machine: machineSchema,
  stacks: z.array(hubStackSchema),
  worktrees: z.array(hubWorktreeSchema),
  events: z.array(hubEventSchema),
  actions: z.object({ canRestart: z.boolean(), canStart: z.boolean() }),
});
export type Hub = z.infer<typeof hubSchema>;

export const logsSchema = z.object({
  lines: z.array(logLineSchema),
  services: z.array(z.string()),
  limit: z.number(),
});
export type Logs = z.infer<typeof logsSchema>;

export const limitSourceSchema = z.enum(["default", "settings", ".env", "env"]);

export const limitSchema = z.object({
  name: z.string(),
  env: z.string(),
  unit: z.string(),
  value: z.number(),
  default: z.number(),
  source: limitSourceSchema,
  min: z.number(),
  max: z.number(),
  allowZero: z.boolean(),
  applies: z.string(),
});
export type Limit = z.infer<typeof limitSchema>;

export const limitsSchema = z.object({
  totalRamBytes: z.number(),
  cpus: z.number(),
  limits: z.array(limitSchema),
});
export type Limits = z.infer<typeof limitsSchema>;

export const actionAnswerSchema = z.union([
  z.object({ message: z.string() }),
  z.object({ error: z.string() }),
]);

export const revealedKeySchema = z.object({ apiKey: z.string() });
