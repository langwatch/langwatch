import { spawn } from "node:child_process";
import { hostname } from "node:os";
import { fileURLToPath } from "node:url";

import { type ClickHouseClient, ClickHouseError, createClient } from "@clickhouse/client";
import {
  parseConnectionUrl,
  reconcileTTL,
  resolveClickHouseMigrationTaskConfig,
  runMigrations,
} from "@langwatch/clickhouse-migrations";
import { READ_HINT_BROADCAST_CHANNEL } from "@langwatch/eventing/server";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import { imageSteps, type UpgradeClickHouse } from "@langwatch/upgrade";
import { readImageTree } from "@langwatch/upgrade/gate";
import { loadReleases, type ManifestStep } from "@langwatch/upgrade/manifest";
import { formatStatus } from "@langwatch/upgrade/reader";
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
import { isMigrationStep, type MigrationStep } from "@langwatch/upgrade/step";

import type { TaskInput } from "./config.ts";
import { lwqlProvision } from "./lwql-provision.ts";
import { withTasksApp } from "./module-task.ts";

export type UpgradeCommand = { command: "run" } | { command: "status" | "plan"; json: boolean };

/** An argument `upgrade` does not take; `code` is what a caller branches on. */
export class UpgradeArgumentError extends Error {
  readonly code = "unknown_upgrade_argument";
  constructor(readonly argument: string) {
    super(
      `upgrade takes no "${argument}". Use: upgrade | upgrade status [--json] | upgrade plan [--json]`,
    );
    this.name = "UpgradeArgumentError";
  }
}

export function parseUpgradeArgs({ args }: { args: readonly string[] }): UpgradeCommand {
  const [first, ...rest] = args;
  if (first === undefined) return { command: "run" };
  if (first !== "status" && first !== "plan") throw new UpgradeArgumentError(first);
  const unknown = rest.find((argument) => argument !== "--json");
  if (unknown !== undefined) throw new UpgradeArgumentError(unknown);
  return { command: first, json: rest.includes("--json") };
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
  if (input.config.skipPrismaMigrate || !url) {
    const error = url ? null : "DATABASE_URL is required to apply the Postgres schema";
    return Promise.resolve({ engine: "postgres", target: "postgres", ok: !!url, error });
  }
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

async function migrateClickHouse({ input }: { input: TaskInput }): Promise<SchemaTargetReport[]> {
  const { config, targets } = clickhouseTargets(input);
  const settings = config.settings;
  const reports: SchemaTargetReport[] = [];
  for (const target of targets) {
    let error: string | null = null;
    try {
      await runMigrations({
        connectionUrl: target.url,
        clusterName: settings?.clusterName,
        childEnvironment: settings?.childEnvironment,
        waitSeconds: settings?.waitSeconds,
        verbose: true,
      });
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
    { name: "langwatchql", run: () => lwqlProvision(input) },
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

/** Hands `use` the steps the installed modules declare, then closes the process that built them. */
export type DeclaredCodeSteps = <Result>(
  use: (steps: readonly MigrationStep[]) => Promise<Result>,
) => Promise<Result>;

/** The tasks process's `.withMigrations` steps (round 14: the framework runs them). */
export const installedCodeSteps: DeclaredCodeSteps = (use) =>
  withTasksApp({ use: (app) => use(app.migrationSteps(isMigrationStep)) });

/** A declared step as the image's tree names it: its owner is the module its id starts with. */
export function codeStepOf(step: MigrationStep): ManifestStep {
  const { id, kind, mode, description } = step;
  return { id, kind, mode, owner: id.slice(0, id.indexOf(":")), description };
}

/**
 * `pnpm task upgrade [status | plan] [--json]` (specs/upgrade/upgrade-command.feature). Exit codes:
 * 0 done, 1 failed, 2 refused below the floor, 3 lease not acquired. The installed modules'
 * code steps are booted first and handed to the runner.
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
  return codeSteps((steps) => runWithCodeSteps({ command, input, write, steps }));
}

async function runWithCodeSteps({
  command,
  input,
  write,
  steps,
}: {
  command: UpgradeCommand;
  input: TaskInput;
  write: (text: string) => void;
  steps: readonly MigrationStep[];
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
      codeSteps: steps,
      releases,
      applier: oneReleaseApplier({ input }),
      reconcilers: reconcilers({ input }),
      identity: { image: newest ?? "unreleased", host: hostname() },
      log: runnerLog(),
      hints: readHints({ input }),
    });
    if (command.command === "status") {
      const status = await runner.status();
      write(`${command.json ? JSON.stringify(status, null, 2) : formatStatus({ status })}\n`);
      return 0;
    }
    if (command.command === "plan") {
      const planned = await runner.plan();
      write(`${command.json ? JSON.stringify(planned, null, 2) : formatPlan(planned)}\n`);
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

/** The registry's `upgrade` task: runs the upgrade and leaves its exit code for the process. */
export async function upgrade(input: TaskInput): Promise<void> {
  const exitCode = await runUpgradeCommand({ args: [], input });
  if (exitCode !== 0) process.exitCode = exitCode;
}
