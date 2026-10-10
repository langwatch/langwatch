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
  /** Why a surface is not live, in one line; detail is the lane line behind it. */
  reason: z.string(),
  detail: z.string(),
  /** The `haven restart` name that bounces this row, "" when it has none. */
  restart: z.string(),
  /** The `haven up +<name>` name that adds this not-selected row, "" when it has none. */
  start: z.string(),
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
  actions: z.object({
    canRestart: z.boolean(),
    canStart: z.boolean(),
    startDir: z.string(),
    canStartService: z.boolean(),
    canResetDatabases: z.boolean(),
  }),
  /** The upgrade gate's refusal while it holds the api, "" otherwise. */
  belowFloor: z.string(),
  /** The seed console: what `haven db seed` takes, its last status line and log tail. */
  seed: z.object({
    canSeed: z.boolean(),
    sizes: z.array(z.string()),
    personas: z.array(z.string()),
    status: z.string(),
    log: z.array(z.string()),
  }),
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

/*
 * `GET /api/stacks/<slug>/cli/<name>` (clireads.go): the {"v":1,...} envelope
 * around the rows `haven <name> --json` prints for this stack.
 */
export const cliReadSchema = <Rows extends z.ZodType>({ rows }: { rows: Rows }) =>
  z.object({ v: z.literal(1), stack: z.string(), rows });

export const simRowSchema = z.object({
  name: z.string(),
  running: z.boolean(),
  console: z.string().optional(),
  start: z.string().optional(),
  verbs: z.array(z.string()).nullable(),
  skill: z.string(),
});
export type SimRow = z.infer<typeof simRowSchema>;

/** A one-shot lane of the last up; duration is Go's nanoseconds. */
export const jobRunSchema = z.object({
  name: z.string(),
  time: z.string(),
  duration: z.number(),
  exit: z.number(),
  output: z.array(z.string()).optional(),
});
export type JobRun = z.infer<typeof jobRunSchema>;

export const storeStatSchema = z.object({
  name: z.string(),
  measure: z.string(),
  used: z.number(),
  limit: z.number(),
  unit: z.string(),
});
export type StoreStat = z.infer<typeof storeStatSchema>;

/** One distinct failure of `haven errors`, grouped and counted. */
export const errorGroupSchema = z.object({
  signature: z.string(),
  message: z.string(),
  lane: z.string(),
  app: z.string(),
  count: z.number(),
  firstSeen: z.string(),
  lastSeen: z.string(),
});
export type ErrorGroup = z.infer<typeof errorGroupSchema>;

/** The orb's page buffer and feedback (tools/thuishaven/adapters/orbstore). */
export const consoleEntrySchema = z.object({ level: z.string(), text: z.string(), at: z.string() });
export type ConsoleEntry = z.infer<typeof consoleEntrySchema>;

export const pageRequestSchema = z.object({
  method: z.string(),
  url: z.string(),
  status: z.number(),
  durationMs: z.number(),
  failed: z.boolean(),
  at: z.string(),
});
export type PageRequest = z.infer<typeof pageRequestSchema>;

export const feedbackSchema = z.object({
  id: z.string(),
  receivedAt: z.string(),
  resolvedAt: z.string().optional(),
  screenshot: z.string().optional(),
  note: z.string(),
  route: z.string(),
  url: z.string(),
});
export type Feedback = z.infer<typeof feedbackSchema>;

/** `haven browser status --json`: the stack's shared browser and its open lanes. */
export const browserStatusSchema = z.object({
  running: z.boolean(),
  pid: z.number().optional(),
  lanes: z.array(z.string()).optional(),
});
export type BrowserStatus = z.infer<typeof browserStatusSchema>;

/** `haven browser snapshot --lane <lane> --json`: the page's accessibility tree. */
export const browserSnapshotSchema = z.object({
  url: z.string(),
  title: z.string(),
  snapshot: z.string(),
});
export type BrowserSnapshot = z.infer<typeof browserSnapshotSchema>;

/** `haven obs traces|metrics|profiles --json`; durations are Go's nanoseconds. */
export const rootSpanSchema = z.object({
  traceId: z.string(),
  time: z.string(),
  service: z.string(),
  name: z.string(),
  duration: z.number(),
  error: z.boolean(),
});
export type RootSpan = z.infer<typeof rootSpanSchema>;

export const seriesSchema = z.object({
  label: z.string(),
  value: z.string(),
  samples: z.array(z.number()).nullable(),
});
export type Series = z.infer<typeof seriesSchema>;

const profileEntrySchema = z.object({ function: z.string(), share: z.number() });
export type ProfileEntry = z.infer<typeof profileEntrySchema>;

export const serviceProfileSchema = z.object({
  service: z.string(),
  cpu: z.array(profileEntrySchema).nullable(),
  heap: z.array(profileEntrySchema).nullable(),
});
export type ServiceProfile = z.infer<typeof serviceProfileSchema>;
