import { spawn } from "node:child_process";
import { hostname } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { type ClickHouseClient, ClickHouseError, createClient } from "@clickhouse/client";
import {
  parseConnectionUrl,
  reconcileTTL,
  resolveClickHouseMigrationTaskConfig,
  runMigrations,
  type GooseOptions,
} from "@langwatch/clickhouse-migrations";
import type { EventUpcastReader } from "@langwatch/eventing";
import { READ_HINT_BROADCAST_CHANNEL } from "@langwatch/eventing/server";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import {
  imageSteps,
  type UpcastStepInput,
  type UpgradeClickHouse,
  type UpgradePostgres,
} from "@langwatch/upgrade";
import { IMAGE_MIGRATION_DIRECTORIES, readImageTree } from "@langwatch/upgrade/gate";
import {
  compareReleases,
  loadReleases,
  type ManifestStep,
  type ReleaseManifest,
  releaseVersionSchema,
} from "@langwatch/upgrade/manifest";
import { formatStatus, preflightFrom, previewUpgradeTo } from "@langwatch/upgrade/reader";
import {
  createUpgradeRunner,
  formatPlan,
  gooseAppliedStepIds,
  type SchemaTargetReport,
  redactSecrets,
  UPGRADE_NEXT_ACTION,
  UPGRADE_STATUS_COMMAND,
  type UpgradeOutcome,
  type UpgradeReadHintPublish,
  type UpgradeReconciler,
  type UpgradeRunnerLog,
  type UpgradeSchemaApplier,
  upgradeReadHintMessage,
} from "@langwatch/upgrade/runner";
import { assertOldWritersGone, recordPreRosterRollback } from "@langwatch/upgrade/serving-roster";
import {
  isDeclaredMigrationStep,
  isMigrationStep,
  type MigrationStep,
  type TenantMigrationStep,
} from "@langwatch/upgrade/step";
import { applyRelease, SteppingError } from "@langwatch/upgrade/stepping";

import type { TaskInput } from "./config.ts";
import { lwqlProvision } from "./lwql-provision.ts";
import { withTasksApp } from "./module-task.ts";

/** Overrides for writers before the serving roster (Round 47 E2; ADR-173, amendment 2026-10-08). */
const PRE_ROSTER_COMMANDS = ["old-writers-gone", "pre-roster-rollback"] as const;
type PreRosterCommand = (typeof PRE_ROSTER_COMMANDS)[number];
const isPreRosterCommand = (argument: string): argument is PreRosterCommand =>
  (PRE_ROSTER_COMMANDS as readonly string[]).includes(argument);

export type UpgradeCommand =
  | { command: "run" }
  | { command: "status"; json: boolean }
  | { command: "plan"; json: boolean; to?: string }
  | { command: PreRosterCommand };

/** An argument `upgrade` does not take; `code` is what a caller branches on. */
export class UpgradeArgumentError extends Error {
  readonly code = "unknown_upgrade_argument";
  constructor(readonly argument: string) {
    super(
      `upgrade takes no "${argument}". Use: upgrade | upgrade status [--json] | upgrade plan [--to <release>] [--json]` +
        " | upgrade steps [--json] [--out <file>] | upgrade old-writers-gone | upgrade pre-roster-rollback",
    );
    this.name = "UpgradeArgumentError";
  }
}

export function parseUpgradeArgs({ args }: { args: readonly string[] }): UpgradeCommand {
  const [first, ...rest] = args;
  if (first === undefined) return { command: "run" };
  if (isPreRosterCommand(first)) {
    if (rest[0] !== undefined) throw new UpgradeArgumentError(rest[0]);
    return { command: first };
  }
  if (first !== "status" && first !== "plan") throw new UpgradeArgumentError(first);
  const toAt = first === "plan" ? rest.indexOf("--to") : -1;
  const to = toAt === -1 ? undefined : rest[toAt + 1];
  if (toAt !== -1 && !releaseVersionSchema.validate(to))
    throw new UpgradeArgumentError(`--to ${to ?? ""}`.trim());
  const flags = toAt === -1 ? rest : rest.toSpliced(toAt, 2);
  const unknown = flags.find((argument) => argument !== "--json");
  if (unknown !== undefined) throw new UpgradeArgumentError(unknown);
  const json = flags.includes("--json");
  if (first === "status") return { command: first, json };
  return to === undefined ? { command: first, json } : { command: first, json, to };
}

/** The migration session's URL with `lock_timeout` added to any session options already there. */
export function withLockTimeout({
  url,
  lockTimeoutMs,
}: {
  url: string;
  lockTimeoutMs: number;
}): string {
  const parsed = new URL(url);
  const option = `-c lock_timeout=${lockTimeoutMs}`;
  const existing = parsed.searchParams.get("options");
  parsed.searchParams.set("options", existing ? `${existing} ${option}` : option);
  return parsed.toString();
}

/** Rows as JSON; a database goose has not created yet holds none (upgrade-command.feature). */
export function sqlReader({
  client,
}: {
  client: Pick<ClickHouseClient, "query">;
}): UpgradeClickHouse {
  return {
    async queryRows<Row extends object>(sql: string): Promise<Row[]> {
      try {
        return await (await client.query({ query: sql, format: "JSONEachRow" })).json<Row>();
      } catch (error) {
        if (error instanceof ClickHouseError && error.type === "UNKNOWN_DATABASE") return [];
        throw error;
      }
    },
  };
}

function clickhouseTargets({ environment }: TaskInput) {
  const config = resolveClickHouseMigrationTaskConfig(environment);
  if (config.skipped || config.buildTime) return { config, targets: [] };
  const targets: { name: string; url: string }[] = [];
  if (config.sharedUrl) targets.push({ name: "shared", url: config.sharedUrl });
  for (const endpoint of config.privateEndpoints) {
    if (targets.some((target) => target.url === endpoint.url)) continue;
    targets.push({ name: `private:${endpoint.organizationId ?? "unknown"}`, url: endpoint.url });
  }
  return { config, targets };
}

/** Postgres left alone: SKIP_PRISMA_MIGRATE set (ok), or no DATABASE_URL (failed). */
function prismaSkipped({ url }: { url: string | undefined }): SchemaTargetReport {
  const error = url ? null : "DATABASE_URL is required to apply the Postgres schema";
  return { engine: "postgres", target: "postgres", ok: !!url, error };
}

function deployPrisma({
  input,
  lockTimeoutMs,
  signal,
}: {
  input: TaskInput;
  lockTimeoutMs: number;
  signal: AbortSignal;
}): Promise<SchemaTargetReport> {
  const url = input.environment.DATABASE_URL;
  if (input.config.skipPrismaMigrate || !url) return Promise.resolve(prismaSkipped({ url }));
  const configPath = fileURLToPath(new URL("../prisma.config.ts", import.meta.url));
  return new Promise((resolve) => {
    const child = spawn("pnpm", ["exec", "prisma", "migrate", "deploy", "--config", configPath], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      stdio: "inherit",
      env: { ...input.environment, DATABASE_URL: withLockTimeout({ url, lockTimeoutMs }) },
      signal,
    });
    const report = (error: string | null): SchemaTargetReport => ({
      engine: "postgres",
      target: "postgres",
      ok: error === null,
      error,
    });
    child.on("error", (error) => resolve(report(error.message)));
    child.on("exit", (code) =>
      resolve(report(code === 0 ? null : `prisma migrate deploy exited with code ${code}`)),
    );
  });
}

function resolvePrismaRolledBack({
  input,
  migration,
  signal,
}: {
  input: TaskInput;
  migration: string;
  signal: AbortSignal;
}): Promise<{ ok: boolean; error: string | null }> {
  const url = input.environment.DATABASE_URL;
  if (input.config.skipPrismaMigrate || !url)
    return Promise.resolve({
      ok: false,
      error: "DATABASE_URL is required and SKIP_PRISMA_MIGRATE unset to resolve a migration",
    });
  const configPath = fileURLToPath(new URL("../prisma.config.ts", import.meta.url));
  return new Promise((resolve) => {
    const child = spawn(
      "pnpm",
      ["exec", "prisma", "migrate", "resolve", "--rolled-back", migration, "--config", configPath],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        stdio: "inherit",
        env: { ...input.environment, DATABASE_URL: url },
        signal,
      },
    );
    child.on("error", (error) => resolve({ ok: false, error: error.message }));
    child.on("exit", (code) =>
      resolve(
        code === 0
          ? { ok: true, error: null }
          : { ok: false, error: `prisma migrate resolve exited with code ${code}` },
      ),
    );
  });
}

/** What goose is run with for one target; `upTo` is set only when stepping a release. */
export function clickHouseRunOptions({
  url,
  settings,
  upTo,
}: {
  url: string;
  settings: Pick<GooseOptions, "clusterName" | "childEnvironment" | "waitSeconds"> | undefined;
  upTo: number | undefined;
}): GooseOptions {
  return {
    connectionUrl: url,
    clusterName: settings?.clusterName,
    childEnvironment: settings?.childEnvironment,
    waitSeconds: settings?.waitSeconds,
    verbose: true,
    ...(upTo === undefined ? {} : { upTo }),
  };
}

async function migrateClickHouse({
  input,
  upTo,
}: {
  input: TaskInput;
  upTo?: number;
}): Promise<SchemaTargetReport[]> {
  const { config, targets } = clickhouseTargets(input);
  const settings = config.settings;
  const reports: SchemaTargetReport[] = [];
  for (const target of targets) {
    let error: string | null = null;
    try {
      await runMigrations(clickHouseRunOptions({ url: target.url, settings, upTo }));
    } catch (failure) {
      error = String(failure instanceof Error ? failure.message : failure)
        .split(target.url)
        .join("<redacted>");
    }
    const client = createClient({
      url: parseConnectionUrl({ connectionUrl: target.url }).databaseUrl,
    });
    const applied = await gooseAppliedStepIds({ clickhouse: sqlReader({ client }) })
      .catch(() => null)
      .finally(() => client.close());
    reports.push({ engine: "clickhouse", target: target.name, ok: error === null, error, applied });
  }
  return reports;
}

/** Today's applier: `prisma migrate deploy` and goose `up` apply everything at once. */
function oneReleaseApplier({ input }: { input: TaskInput }): UpgradeSchemaApplier {
  let applied: readonly SchemaTargetReport[] | null = null;
  return {
    async apply({ lockTimeoutMs, signal }) {
      if (applied?.every((report) => report.ok)) return applied;
      applied = [
        await deployPrisma({ input, lockTimeoutMs, signal }),
        ...(await migrateClickHouse({ input })),
      ];
      return applied;
    },
    resolveRolledBack: ({ migration, signal }) =>
      resolvePrismaRolledBack({ input, migration, signal }),
  };
}

/** What stepping to a release applies: every Prisma folder and the last goose version up to it. */
export function releaseSchemaUpTo({
  release,
  manifests,
}: {
  release: string;
  manifests: readonly ReleaseManifest[];
}): { prismaFolders: string[]; gooseUpTo: number | null } {
  const ids = manifests
    .filter((manifest) => compareReleases({ left: manifest.release, right: release }) <= 0)
    .flatMap((manifest) => manifest.steps.map((step) => step.id));
  const named = (prefix: string) =>
    ids.filter((id) => id.startsWith(prefix)).map((id) => id.slice(prefix.length));
  const versions = named("clickhouse:").map(Number);
  return {
    prismaFolders: named("prisma:"),
    gooseUpTo: versions.length > 0 ? Math.max(...versions) : null,
  };
}

/** What one stepped release did: its target reports and the Prisma folders it applied. */
export type SteppedSchema = Readonly<{
  reports: readonly SchemaTargetReport[];
  applied: readonly string[];
}>;

/** Applies the schema up to one release; the stepping applier calls it once per release. */
export type StepSchemaTo = (args: {
  release: string;
  prismaFolders: readonly string[];
  gooseUpTo: number | null;
  lockTimeoutMs: number;
  signal: AbortSignal;
}) => Promise<SteppedSchema>;

/** Said once, when the first schema to apply is older than the image's release. */
export function steppingStartsLine({
  imageRelease,
}: {
  imageRelease: string | null;
}): UpgradeTaskLine {
  return {
    level: "info",
    message: `the upgrade crosses several releases: the schema steps one release at a time up to ${imageRelease ?? "this image"}, each release's blocking steps after its schema`,
    fields: { phase: "schema", waitingOn: "nothing", next: "nothing to do: wait for the run" },
  };
}

/** Said before one release's schema is applied. */
export function stepToLine({
  release,
  prismaFolders,
  gooseUpTo,
}: {
  release: string;
  prismaFolders: readonly string[];
  gooseUpTo: number | null;
}): UpgradeTaskLine {
  const clickhouse =
    gooseUpTo === null ? "no ClickHouse version up to it" : `ClickHouse up to version ${gooseUpTo}`;
  return {
    level: "info",
    message: `stepping the schema to ${release}: ${prismaFolders.length} Prisma folder(s) up to it, ${clickhouse}`,
    fields: {
      phase: "schema",
      release,
      waitingOn: "prisma migrate deploy, then goose",
      next: "nothing to do: wait for the run",
    },
  };
}

/** Said after one release's schema: what it applied, or which targets failed. */
export function steppedLine({
  release,
  stepped,
}: {
  release: string;
  stepped: SteppedSchema;
}): UpgradeTaskLine {
  const failed = stepped.reports.filter((report) => !report.ok).map((report) => report.target);
  const fields = { phase: "schema", release, applied: stepped.applied };
  if (failed.length === 0)
    return {
      level: "info",
      message: `schema stepped to ${release}: ${stepped.applied.length} Prisma migration(s) applied; its blocking steps run next`,
      fields: { ...fields, waitingOn: "nothing" },
    };
  return {
    level: "warn",
    message: `schema step to ${release} failed on ${failed.join(", ")}`,
    fields: { ...fields, failed, waitingOn: "the runner's retry or its failure report" },
  };
}

/**
 * One release, a fresh install or only the unreleased tail: the one-pass applier, unchanged. A
 * first schema older than the image steps each release in turn, the unreleased tail in one pass
 * (specs/upgrade/stepping.feature).
 */
export function releaseSteppingApplier({
  imageRelease,
  manifests,
  onePass,
  stepTo,
  say,
}: {
  imageRelease: string | null;
  manifests: readonly ReleaseManifest[];
  onePass: UpgradeSchemaApplier;
  stepTo: StepSchemaTo;
  say: (line: UpgradeTaskLine) => void;
}): UpgradeSchemaApplier {
  let stepping: boolean | undefined;
  return {
    ...onePass,
    async apply(args) {
      const { release, lockTimeoutMs, signal } = args;
      if (stepping === undefined) {
        stepping = release !== null && release !== imageRelease;
        if (stepping) say(steppingStartsLine({ imageRelease }));
      }
      if (!stepping || release === null) return onePass.apply(args);
      const schema = releaseSchemaUpTo({ release, manifests });
      say(stepToLine({ release, ...schema }));
      const stepped = await stepTo({ release, ...schema, lockTimeoutMs, signal });
      say(steppedLine({ release, stepped }));
      return stepped.reports;
    },
  };
}

/** One release's Postgres schema through the stepping applier's release directory. */
async function stepPrisma({
  input,
  release,
  prismaFolders,
  lockTimeoutMs,
  signal,
}: {
  input: TaskInput;
  release: string;
  prismaFolders: readonly string[];
  lockTimeoutMs: number;
  signal: AbortSignal;
}): Promise<SteppedSchema> {
  const url = input.environment.DATABASE_URL;
  if (input.config.skipPrismaMigrate || !url)
    return { reports: [prismaSkipped({ url })], applied: [] };
  const failed = (error: string): SteppedSchema => ({
    reports: [{ engine: "postgres", target: "postgres", ok: false, error }],
    applied: [],
  });
  try {
    const { targets } = await applyRelease({
      release,
      prismaFolders: prismaFolders.map((name) => join(IMAGE_MIGRATION_DIRECTORIES.prisma, name)),
      gooseUpTo: null,
      postgresUrl: withLockTimeout({ url, lockTimeoutMs }),
      clickhouseTargets: [],
      environment: input.environment,
      signal,
    });
    const postgres = targets[0];
    if (postgres?.status === "applied")
      return {
        reports: [{ engine: "postgres", target: "postgres", ok: true, error: null }],
        applied: postgres.applied,
      };
    if (postgres?.status === "failed") {
      const code = postgres.code ? ` (${postgres.code})` : "";
      return {
        ...failed(`prisma migrate deploy to ${release} failed${code}: ${postgres.message}`),
        applied: postgres.applied,
      };
    }
    return failed(`prisma migrate deploy to ${release} did not run: the upgrade was aborted`);
  } catch (error) {
    if (!(error instanceof SteppingError)) throw error;
    return failed(`${error.code}: ${error.message}`);
  }
}

/** Postgres up to the release, then ClickHouse once a release up to it carries a goose version. */
function stepSchemaTo({ input }: { input: TaskInput }): StepSchemaTo {
  return async ({ release, prismaFolders, gooseUpTo, lockTimeoutMs, signal }) => {
    const postgres = await stepPrisma({ input, release, prismaFolders, lockTimeoutMs, signal });
    if (!postgres.reports.every((report) => report.ok) || gooseUpTo === null) return postgres;
    const clickhouse = await migrateClickHouse({ input, upTo: gooseUpTo });
    return { ...postgres, reports: [...postgres.reports, ...clickhouse] };
  };
}

function reconcilers({ input }: { input: TaskInput }): UpgradeReconciler[] {
  const { config, targets } = clickhouseTargets(input);
  return [
    ...targets.map((target) => ({
      name: `clickhouse-ttl:${target.name}`,
      run: () =>
        reconcileTTL({
          connectionUrl: target.url,
          clusterName: config.settings?.clusterName,
          coldStorageEnabled: config.settings?.coldStorageEnabled ?? false,
          hotDayOverrides: config.settings?.hotDayOverrides ?? {},
          verbose: true,
        }),
    })),
    { name: "langwatchql", run: () => lwqlProvision({ ...input, failOnError: true }) },
  ];
}

/** The run's read hints on the framework's channel, for the api to relay (round 8, U2-LIVE). */
function readHints({ input }: { input: TaskInput }): UpgradeReadHintPublish | undefined {
  const redis = input.connections.redis;
  if (!redis) return undefined;
  return (hint) =>
    redis.publish(
      READ_HINT_BROADCAST_CHANNEL,
      upgradeReadHintMessage({ hint, timestamp: nowInstant().epochMilliseconds }),
    );
}

function runnerLog(): UpgradeRunnerLog {
  const logger = createLogger("langwatch:tasks:upgrade");
  return {
    info: (message, fields) => logger.info(fields ?? {}, message),
    warn: (message, fields) => logger.warn(fields ?? {}, message),
  };
}

/** A log line the task writes, kept pure so its wording is tested without a logger. */
export type UpgradeTaskLine = Readonly<{
  level: "info" | "warn" | "error";
  message: string;
  fields: Record<string, unknown>;
}>;

/** Said before a run with no ClickHouse target: the gate refuses to serve without one. */
export function noClickHouseLine(): UpgradeTaskLine {
  return {
    level: "warn",
    message:
      "no ClickHouse target is configured: the upgrade applies Postgres only, and the api and " +
      "worker refuse to serve until CLICKHOUSE_URL is set",
    fields: {
      phase: "preflight",
      waitingOn: "nothing",
      next: "set CLICKHOUSE_URL (or a private ClickHouse route), then run `pnpm task upgrade` again",
    },
  };
}

/** The task's last lines: the outcome, then where the UI is and what `upgrade status` shows. */
export function closingLines({
  outcome,
  baseHost,
}: {
  outcome: UpgradeOutcome;
  baseHost: string | undefined;
}): UpgradeTaskLine[] {
  const { code, runId } = outcome;
  const next = UPGRADE_NEXT_ACTION[code];
  const status = `\`${UPGRADE_STATUS_COMMAND}\` shows every step and run`;
  const ui = baseHost?.trim()
    ? `the UI is at ${baseHost.trim()} (Upgrades, for platform operators)`
    : "BASE_HOST is not set: set it to the address operators open the UI at";
  const message = redactSecrets(outcome.message);
  const fields = { phase: "finished", code, runId, next };
  const first: UpgradeTaskLine =
    outcome.exitCode === 0
      ? { level: "info", message, fields }
      : { level: "error", message, fields: { ...fields, ...redactDetail(outcome.detail) } };
  const where =
    outcome.exitCode === 0
      ? `upgrade complete; ${ui}`
      : `upgrade exited ${outcome.exitCode}; ${ui}`;
  return [
    first,
    { level: "info", message: `${where}; ${status}`, fields: { phase: "finished", next } },
  ];
}

function redactDetail(detail: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(redactSecrets(JSON.stringify(detail))) as Record<string, unknown>;
}

function writeLine({
  logger,
  line,
}: {
  logger: ReturnType<typeof createLogger>;
  line: UpgradeTaskLine;
}) {
  logger[line.level](line.fields, line.message);
}

/**
 * Hands `use` the steps the installed modules declare and, where the process holds an event log,
 * their upcasts; then closes the process that built them.
 */
export type DeclaredCodeSteps = <Result>(
  use: (declared: {
    steps: readonly (MigrationStep | TenantMigrationStep)[];
    upcasts?: () => Promise<readonly UpcastStepInput[]>;
  }) => Promise<Result>,
) => Promise<Result>;

/** The tasks process's `.withMigrations` steps (round 14) and event upcasts (Alex, 2026-10-09). */
export const installedCodeSteps: DeclaredCodeSteps = (use) =>
  withTasksApp({
    use: (app) =>
      use({ steps: app.migrationSteps(isDeclaredMigrationStep), upcasts: upcastStepsOf({ app }) }),
  });

/** The declared event upcasts as ledger rows (§9); none where the process holds no event log. */
export function upcastStepsOf({
  app,
}: {
  app: { upcastReader(): Pick<EventUpcastReader, "findActiveUpcasts"> | undefined };
}): () => Promise<UpcastStepInput[]> {
  return async () => {
    const active = (await app.upcastReader()?.findActiveUpcasts()) ?? [];
    return active.map(({ id, storedEvents, ...report }) => ({ id, storedEvents, report }));
  };
}

/** A declared step as the image's tree names it: its owner is the module its id starts with. */
export function codeStepOf(step: MigrationStep | TenantMigrationStep): ManifestStep {
  const { id, kind, mode, description, finishBy, needsOldWritersGone } = step;
  const owner = id.slice(0, id.indexOf(":"));
  return {
    id,
    kind,
    mode,
    owner,
    description,
    ...(finishBy === undefined ? {} : { finishBy }),
    ...(needsOldWritersGone === undefined ? {} : { needsOldWritersGone }),
  };
}

/**
 * `pnpm task upgrade [status | plan [--to <release>]] [--json]`
 * (specs/upgrade/upgrade-command.feature). Exit codes: 0 done, 1 failed, 2 refused below the
 * floor, 3 lease not acquired. The installed modules' code steps are booted first.
 */
export async function runUpgradeCommand({
  args,
  input,
  write = (text) => process.stdout.write(text),
  codeSteps = installedCodeSteps,
}: {
  args: readonly string[];
  input: TaskInput;
  write?: (text: string) => void;
  codeSteps?: DeclaredCodeSteps;
}): Promise<number> {
  const command = parseUpgradeArgs({ args });
  if (command.command === "old-writers-gone" || command.command === "pre-roster-rollback") {
    const database = input.connections.database;
    if (!database) throw new Error("DATABASE_URL is required to upgrade");
    return runPreRosterCommand({ command: command.command, postgres: database.sql, write });
  }
  return codeSteps(({ steps, upcasts }) =>
    runWithCodeSteps({ command, input, write, steps, upcasts }),
  );
}

/** Records one override for writers before the roster; no lease and no module boot. Exit 0. */
export async function runPreRosterCommand({
  command,
  postgres,
  write,
  actor = `pnpm task upgrade ${command} on ${hostname()}`,
}: {
  command: PreRosterCommand;
  postgres: UpgradePostgres;
  write: (text: string) => void;
  actor?: string;
}): Promise<number> {
  if (command === "old-writers-gone") {
    const { recordedAt } = await assertOldWritersGone({ postgres, actor });
    write(
      `old writers before the serving roster asserted gone at ${recordedAt.toISOString()}: ` +
        "steps that wait for old writers run once every live process declares them\n",
    );
    return 0;
  }
  const { recordedAt, reopened } = await recordPreRosterRollback({ postgres, actor });
  write(
    `rollback to an image before the serving roster recorded at ${recordedAt.toISOString()}; ` +
      `reopened: ${reopened.length > 0 ? reopened.join(", ") : "none"}. Steps that wait for old ` +
      "writers hold until `pnpm task upgrade old-writers-gone` runs after the next rollout, or " +
      "until the grace after the next upgrade run\n",
  );
  return 0;
}

async function runWithCodeSteps({
  command,
  input,
  write,
  steps,
  upcasts,
}: {
  command: UpgradeCommand;
  input: TaskInput;
  write: (text: string) => void;
  steps: readonly (MigrationStep | TenantMigrationStep)[];
  upcasts: (() => Promise<readonly UpcastStepInput[]>) | undefined;
}): Promise<number> {
  const database = input.connections.database;
  if (!database) throw new Error("DATABASE_URL is required to upgrade");
  const releases = loadReleases();
  const newest = releases.manifests.at(-1)?.release ?? null;
  const { targets } = clickhouseTargets(input);
  const sharedUrl = targets.find((target) => target.name === "shared")?.url;
  const logger = createLogger("langwatch:tasks:upgrade");
  if (command.command === "run" && targets.length === 0)
    writeLine({ logger, line: noClickHouseLine() });
  const shared = sharedUrl
    ? createClient({ url: parseConnectionUrl({ connectionUrl: sharedUrl }).databaseUrl })
    : undefined;
  try {
    const runner = createUpgradeRunner({
      postgres: database.sql,
      clickhouse: shared ? sqlReader({ client: shared }) : undefined,
      image: {
        release: newest,
        steps: imageSteps({
          release: newest ?? "0.0.0",
          tree: readImageTree({ codeSteps: steps.map(codeStepOf) }),
        }),
      },
      // Registered on the ledger, run only here: tenant steps are ops' pass (S6-WIRE).
      codeSteps: steps.filter(isMigrationStep),
      releases,
      applier: releaseSteppingApplier({
        imageRelease: newest,
        manifests: releases.manifests,
        onePass: oneReleaseApplier({ input }),
        stepTo: stepSchemaTo({ input }),
        say: (line) => writeLine({ logger, line }),
      }),
      reconcilers: reconcilers({ input }),
      identity: { image: newest ?? "unreleased", host: hostname() },
      log: runnerLog(),
      hints: readHints({ input }),
      ...(upcasts === undefined ? {} : { upcasts }),
    });
    if (command.command === "status") {
      const status = await runner.status();
      write(`${command.json ? JSON.stringify(status, null, 2) : formatStatus({ status })}\n`);
      return 0;
    }
    if (command.command === "plan") {
      await printPlan({ command, runner, image: { release: newest }, write });
      return 0;
    }
    const outcome = await runner.run({ signal: input.signal });
    const baseHost = input.environment.BASE_HOST;
    for (const line of closingLines({ outcome, baseHost })) writeLine({ logger, line });
    return outcome.exitCode;
  } finally {
    await shared?.close();
  }
}

/** `upgrade plan` prints the plan; with `--to`, the plan narrowed to it and the preflight. */
async function printPlan({
  command,
  runner,
  image,
  write,
}: {
  command: Extract<UpgradeCommand, { command: "plan" }>;
  runner: Pick<ReturnType<typeof createUpgradeRunner>, "plan" | "status">;
  image: { release: string | null };
  write: (text: string) => void;
}): Promise<void> {
  const planned = await runner.plan();
  if (command.to === undefined) {
    write(`${command.json ? JSON.stringify(planned, null, 2) : formatPlan(planned)}\n`);
    return;
  }
  const preview = {
    installed: planned.installed,
    plan: previewUpgradeTo({ plan: planned.plan, image, to: command.to }),
    preflight: preflightFrom({ status: await runner.status() }),
  };
  write(`${command.json ? JSON.stringify(preview, null, 2) : formatPreview(preview)}\n`);
}

/** `upgrade plan --to` as text: the narrowed plan, then one line per preflight row. */
export function formatPreview({
  installed,
  plan,
  preflight,
}: {
  installed: string | null;
  plan: ReturnType<typeof previewUpgradeTo>;
  preflight: ReturnType<typeof preflightFrom>;
}): string {
  const head =
    plan.outcome === "refused"
      ? `Refused (${plan.code}): ${plan.message}`
      : formatPlan({ installed, plan });
  const rows = preflight.map((row) =>
    [`  ${row.outcome}: ${row.name}`, row.detail, row.fix && `fix: ${row.fix}`]
      .filter(Boolean)
      .join("; "),
  );
  return [head, "Preflight:", ...rows].join("\n");
}

/** The registry's `upgrade` task: runs the upgrade and leaves its exit code for the process. */
export async function upgrade(input: TaskInput): Promise<void> {
  const exitCode = await runUpgradeCommand({ args: [], input });
  if (exitCode !== 0) process.exitCode = exitCode;
}
