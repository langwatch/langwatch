/**
 * The image's upgrade, composed once for every entry point: the worker's gate runs it in-process
 * and `pnpm task upgrade` runs it as a run-once worker (Alex, 2026-10-11, slice 2). Prisma and
 * goose still run as their own programs. Specs: upgrade-command.feature, stepping.feature.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

import { type ClickHouseClient, ClickHouseError, createClient } from "@clickhouse/client";
import {
  type GooseOptions,
  parseConnectionUrl,
  reconcileTTL,
  resolveClickHouseMigrationTaskConfig,
  runMigrations,
} from "@langwatch/clickhouse-migrations";
import type { EventUpcastReader } from "@langwatch/eventing";
import { READ_HINT_BROADCAST_CHANNEL } from "@langwatch/eventing/server";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import { TASKS_APP_DIRECTORY } from "../gate/first-install-upgrade.ts";
import {
  IMAGE_MIGRATION_DIRECTORIES,
  imagePrismaFolders,
  imageRelease,
  imageSteps,
  readImageTree,
} from "../gate/image-tree.ts";
import type { UpcastStepInput } from "../ledger.ts";
import { loadReleases } from "../manifest/manifest-loader.ts";
import type { ManifestStep } from "../manifest/manifest.ts";
import type { UpgradeClickHouse, UpgradePostgres } from "../ports.ts";
import {
  isMigrationStep,
  type MigrationStep,
  type TenantMigrationStep,
} from "../step/migration-step.ts";
import { ledgerRedactor } from "../step/step-log.ts";
import { applyRelease } from "../stepping/apply-release.ts";
import { SteppingError } from "../stepping/release-directory.ts";
import {
  releaseSteppingApplier,
  type SteppedSchema,
  type StepSchemaTo,
  type UpgradeTaskLine,
  withLockTimeout,
} from "./release-stepping-applier.ts";
import { upgradeReadHintMessage, type UpgradeReadHintPublish } from "./run-hint.ts";
import { redactSecrets, UPGRADE_NEXT_ACTION, UPGRADE_STATUS_COMMAND } from "./run-log.ts";
import {
  gooseAppliedStepIds,
  isPrivateTarget,
  PRIVATE_TARGET_PREFIX,
  type SchemaTargetReport,
  type UpgradeReconciler,
  type UpgradeRunnerLog,
  type UpgradeSchemaApplier,
} from "./schema-applier.ts";
import type { UpgradeOutcome } from "./upgrade-outcome.ts";
import { createUpgradeRunner, type UpgradeRunner } from "./upgrade-runner.ts";

/** What the image's upgrade is composed from; every connection string arrives resolved. */
export type ImageUpgradeInputs = Readonly<{
  /** The ledger's connection, in the installation's schema. */
  postgres: UpgradePostgres;
  /** DATABASE_URL for the Prisma programs; absent fails the Postgres target by name. */
  databaseUrl: string | undefined;
  /** The process environment, with the store URLs the secrets chain resolved laid over it. */
  environment: Readonly<Record<string, string | undefined>>;
  /** Development realigns the checksums of rewritten unreleased migrations; nothing else does. */
  development: boolean;
  steps: readonly (MigrationStep | TenantMigrationStep)[];
  upcasts?: () => Promise<readonly UpcastStepInput[]>;
  /** Module work after the schema (LangWatchQL, the pass request), after the TTL reconcilers. */
  reconcilers?: readonly UpgradeReconciler[];
  /** Told when the blocking part is done: a serving worker takes jobs then (T0-F11). */
  onBlockingDone?: () => void;
  /** Publishes on Redis, for the read hints the api relays; absent publishes none. */
  publish?: (channel: string, message: string) => Promise<unknown>;
}>;

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

function clickhouseTargets({ environment }: Pick<ImageUpgradeInputs, "environment">) {
  const config = resolveClickHouseMigrationTaskConfig({ ...environment });
  if (config.buildTime) return { config, targets: [] };
  const targets: { name: string; url: string }[] = [];
  if (config.sharedUrl) targets.push({ name: "shared", url: config.sharedUrl });
  for (const endpoint of config.privateEndpoints) {
    if (targets.some((target) => target.url === endpoint.url)) continue;
    const name = `${PRIVATE_TARGET_PREFIX}${endpoint.organizationId ?? "unknown"}`;
    targets.push({ name, url: endpoint.url });
  }
  return { config, targets };
}

/** The ledger name of every ClickHouse target the environment configures, shared first. */
export function configuredClickHouseTargets({
  environment,
}: Pick<ImageUpgradeInputs, "environment">): string[] {
  return clickhouseTargets({ environment }).targets.map((target) => target.name);
}

/** Postgres left alone because no DATABASE_URL is set: a failed target. */
function prismaMissing(): SchemaTargetReport {
  const error = "DATABASE_URL is required to apply the Postgres schema";
  return { engine: "postgres", target: "postgres", ok: false, error };
}

const PRISMA_CONFIG = join(TASKS_APP_DIRECTORY, "prisma.config.ts");

/** One Prisma program in the tasks app, where its config and binary live; its exit as an error. */
function runPrisma({
  args,
  environment,
  databaseUrl,
  signal,
}: {
  args: readonly string[];
  environment: ImageUpgradeInputs["environment"];
  databaseUrl: string;
  signal: AbortSignal;
}): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn("pnpm", ["exec", "prisma", ...args, "--config", PRISMA_CONFIG], {
      cwd: TASKS_APP_DIRECTORY,
      stdio: "inherit",
      env: { ...environment, DATABASE_URL: databaseUrl },
      signal,
    });
    child.on("error", (error) => resolve(error.message));
    child.on("exit", (code) =>
      resolve(code === 0 ? null : `prisma ${args.slice(0, 2).join(" ")} exited with code ${code}`),
    );
  });
}

async function deployPrisma({
  inputs,
  lockTimeoutMs,
  signal,
}: {
  inputs: ImageUpgradeInputs;
  lockTimeoutMs: number;
  signal: AbortSignal;
}): Promise<SchemaTargetReport> {
  const url = inputs.databaseUrl;
  if (!url) return prismaMissing();
  const error = await runPrisma({
    args: ["migrate", "deploy"],
    environment: inputs.environment,
    databaseUrl: withLockTimeout({ url, lockTimeoutMs }),
    signal,
  });
  return { engine: "postgres", target: "postgres", ok: error === null, error };
}

async function resolvePrismaRolledBack({
  inputs,
  migration,
  signal,
}: {
  inputs: ImageUpgradeInputs;
  migration: string;
  signal: AbortSignal;
}): Promise<{ ok: boolean; error: string | null }> {
  const url = inputs.databaseUrl;
  if (!url) return { ok: false, error: "DATABASE_URL is required to resolve a migration" };
  const error = await runPrisma({
    args: ["migrate", "resolve", "--rolled-back", migration],
    environment: inputs.environment,
    databaseUrl: url,
    signal,
  });
  return { ok: error === null, error };
}

/**
 * How long a private target is waited for before the runner holds it: only the shared target
 * delays ready by the full connect wait; a held private target catches up on a later pass.
 */
export const PRIVATE_TARGET_WAIT_SECONDS = 5;

/** What goose is run with for one target; `upTo` is set only when stepping a release. */
export function clickHouseRunOptions({
  url,
  settings,
  upTo,
  signal,
  privateTarget = false,
}: {
  url: string;
  settings: Pick<GooseOptions, "clusterName" | "childEnvironment" | "waitSeconds"> | undefined;
  upTo: number | undefined;
  /** The upgrade lease's signal: losing the lease kills goose. */
  signal: AbortSignal | undefined;
  /** A private target is tried briefly, then held (T7-F16). */
  privateTarget?: boolean;
}): GooseOptions {
  const waitSeconds = privateTarget
    ? Math.min(settings?.waitSeconds ?? PRIVATE_TARGET_WAIT_SECONDS, PRIVATE_TARGET_WAIT_SECONDS)
    : settings?.waitSeconds;
  return {
    connectionUrl: url,
    clusterName: settings?.clusterName,
    childEnvironment: settings?.childEnvironment,
    waitSeconds,
    verbose: true,
    signal,
    ...(upTo === undefined ? {} : { upTo }),
  };
}

async function migrateClickHouse({
  inputs,
  upTo,
  signal,
  skipTargets,
}: {
  inputs: ImageUpgradeInputs;
  upTo?: number;
  signal: AbortSignal;
  /** Targets the runner holds back this run: a down private target is waited for once. */
  skipTargets?: ReadonlySet<string>;
}): Promise<SchemaTargetReport[]> {
  const { config, targets } = clickhouseTargets(inputs);
  const settings = config.settings;
  const reports: SchemaTargetReport[] = [];
  for (const target of targets.filter(({ name }) => !skipTargets?.has(name))) {
    let error: string | null = null;
    try {
      await runMigrations(
        clickHouseRunOptions({
          url: target.url,
          settings,
          upTo,
          signal,
          privateTarget: isPrivateTarget({ target: target.name }),
        }),
      );
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

/**
 * Unreleased migrations rewritten in place (Alex, 2026-10-09; guarded 2026-10-11). A local dev
 * database that applied the old text gets the new checksum, so `prisma migrate dev` asks no reset.
 * ponytail: delete this list once the next release ships; never extend it to a released migration.
 */
const REWRITTEN_UNRELEASED_MIGRATIONS = [
  "20261006150001_authz_user_standing",
  "20261006150002_gateway_trace_export_key",
  "20261006150003_api_key_system_managed",
  "20261006160000_organization_dataset_attachment_max_mb",
  "20261006170501_web_push",
  "20261006170502_stored_objects",
  "20261006170503_feature_flag_experiment_settings",
  "20261006170504_sso_authentication_activity_provider_account_id",
  "20261006170505_project_active_day",
  "20261006170506_virtual_key_connect_services",
  "20261006170507_virtual_key_license_facts",
  "20261006170508_gateway_connect_upstream",
  "20261006170509_dataset_source_stored_object",
  "20261006170510_issued_license_seats_raised_from",
  "20261006170511_connected_seat_change_not_onboarded",
  "20261006170512_role_name_live_unique_bindings_not_unique",
  "20261006170513_slack_connection_claim",
  "20261006170514_nurturing_read_model",
  "20261006170515_nurturing_simulation_run_count",
  "20261006170516_billing_checkpoint_counted_event_id",
  "20261006170517_user_notification_preferences",
  "20261006170518_trace_ingest_source_billing",
  "20261006170527_data_privacy_project_scope",
  "20261006180001_gateway_realtime_session_metering",
] as const;

/** Development only: production never rewrites a recorded checksum. */
async function realignRewrittenChecksums({ inputs }: { inputs: ImageUpgradeInputs }) {
  if (!inputs.development) return;
  const sql = inputs.postgres;
  const { rows } = await sql.query<{ present: boolean }>(
    `SELECT to_regclass('_prisma_migrations') IS NOT NULL AS present`,
  );
  if (!rows[0]?.present) return;
  for (const name of REWRITTEN_UNRELEASED_MIGRATIONS) {
    const text = readFileSync(join(IMAGE_MIGRATION_DIRECTORIES.prisma, name, "migration.sql"));
    const checksum = createHash("sha256").update(text).digest("hex");
    await sql.query(
      `UPDATE "_prisma_migrations" SET "checksum" = $1
        WHERE "migration_name" = $2 AND "checksum" <> $1 AND "finished_at" IS NOT NULL`,
      [checksum, name],
    );
  }
}

/** One pass: `prisma migrate deploy` and goose `up` apply everything at once. */
function oneReleaseApplier({ inputs }: { inputs: ImageUpgradeInputs }): UpgradeSchemaApplier {
  let applied: readonly SchemaTargetReport[] | null = null;
  return {
    async apply({ lockTimeoutMs, signal, skipTargets }) {
      if (applied?.every((report) => report.ok)) return applied;
      await realignRewrittenChecksums({ inputs });
      applied = [
        await deployPrisma({ inputs, lockTimeoutMs, signal }),
        ...(await migrateClickHouse({ inputs, signal, skipTargets })),
      ];
      return applied;
    },
    resolveRolledBack: ({ migration, signal }) =>
      resolvePrismaRolledBack({ inputs, migration, signal }),
  };
}

/** One release's Postgres schema through the stepping applier's release directory. */
async function stepPrisma({
  inputs,
  release,
  prismaFolders,
  lockTimeoutMs,
  signal,
}: {
  inputs: ImageUpgradeInputs;
  release: string;
  prismaFolders: readonly string[];
  lockTimeoutMs: number;
  signal: AbortSignal;
}): Promise<SteppedSchema> {
  const url = inputs.databaseUrl;
  if (!url) return { reports: [prismaMissing()], applied: [] };
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
      environment: inputs.environment,
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
function stepSchemaTo({ inputs }: { inputs: ImageUpgradeInputs }): StepSchemaTo {
  return async ({ release, prismaFolders, gooseUpTo, lockTimeoutMs, signal, skipTargets }) => {
    const postgres = await stepPrisma({ inputs, release, prismaFolders, lockTimeoutMs, signal });
    if (!postgres.reports.every((report) => report.ok) || gooseUpTo === null) return postgres;
    const clickhouse = await migrateClickHouse({ inputs, upTo: gooseUpTo, signal, skipTargets });
    return { ...postgres, reports: [...postgres.reports, ...clickhouse] };
  };
}

/** Each ClickHouse target's TTL, then the module work the entry point hands in. */
function reconcilers({ inputs }: { inputs: ImageUpgradeInputs }): UpgradeReconciler[] {
  const { config, targets } = clickhouseTargets(inputs);
  return [
    ...targets.map((target) => ({
      name: `clickhouse-ttl:${target.name}`,
      target: target.name,
      run: () =>
        reconcileTTL({
          connectionUrl: target.url,
          clusterName: config.settings?.clusterName,
          coldStorageEnabled: config.settings?.coldStorageEnabled ?? false,
          hotDayOverrides: config.settings?.hotDayOverrides ?? {},
          verbose: true,
        }),
    })),
    ...(inputs.reconcilers ?? []),
  ];
}

/** The run's read hints on the framework's channel, for the api to relay (round 8, U2-LIVE). */
function readHints({ inputs }: { inputs: ImageUpgradeInputs }): UpgradeReadHintPublish | undefined {
  const publish = inputs.publish;
  if (!publish) return undefined;
  return (hint) =>
    publish(
      READ_HINT_BROADCAST_CHANNEL,
      upgradeReadHintMessage({ hint, timestamp: nowInstant().epochMilliseconds }),
    );
}

const logger = createLogger("langwatch:upgrade");

/** The runner's narration on the process logger. */
export function upgradeRunnerLog(): UpgradeRunnerLog {
  return {
    info: (message, fields) => logger.info(fields ?? {}, message),
    warn: (message, fields) => logger.warn(fields ?? {}, message),
  };
}

/** Writes one of the upgrade's own lines on the process logger. */
export function writeUpgradeLine(line: UpgradeTaskLine): void {
  logger[line.level](line.fields, line.message);
}

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

/** The run's last lines: the outcome, then where the UI is and what `upgrade status` shows. */
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

/** The composed runner, the image's release and whether any ClickHouse target is configured. */
export type ImageUpgradeRunner = Readonly<{
  runner: UpgradeRunner;
  release: string | null;
  withClickHouse: boolean;
}>;

/**
 * Composes the runner over the image's tree, manifests and declared steps, hands it to `use`, then
 * closes the shared ClickHouse reader. Tenant steps are registered but run only by ops' pass.
 */
export async function withImageUpgradeRunner<Result>({
  inputs,
  use,
}: {
  inputs: ImageUpgradeInputs;
  use: (composed: ImageUpgradeRunner) => Promise<Result>;
}): Promise<Result> {
  const releases = loadReleases();
  const tree = readImageTree({ codeSteps: inputs.steps.map(codeStepOf) });
  const release = imageRelease({ manifests: releases.manifests, tree });
  const { targets } = clickhouseTargets(inputs);
  const sharedUrl = targets.find((target) => target.name === "shared")?.url;
  const shared = sharedUrl
    ? createClient({ url: parseConnectionUrl({ connectionUrl: sharedUrl }).databaseUrl })
    : undefined;
  try {
    const runner = createUpgradeRunner({
      postgres: inputs.postgres,
      ...(shared ? { clickhouse: sqlReader({ client: shared }) } : {}),
      image: {
        release,
        steps: imageSteps({ release: release ?? "0.0.0", tree }),
        prismaFolders: imagePrismaFolders(),
      },
      // Registered on the ledger, run only here: tenant steps are ops' pass (S6-WIRE).
      codeSteps: inputs.steps.filter(isMigrationStep),
      releases,
      applier: releaseSteppingApplier({
        imageRelease: release,
        manifests: releases.manifests,
        onePass: oneReleaseApplier({ inputs }),
        stepTo: stepSchemaTo({ inputs }),
        say: writeUpgradeLine,
      }),
      clickhouseTargets: targets.map((target) => target.name),
      reconcilers: reconcilers({ inputs }),
      ...(inputs.onBlockingDone ? { onBlockingDone: inputs.onBlockingDone } : {}),
      identity: { image: release ?? "unreleased", host: hostname() },
      log: upgradeRunnerLog(),
      ...(inputs.publish ? { hints: readHints({ inputs }) } : {}),
      ...(inputs.upcasts === undefined ? {} : { upcasts: inputs.upcasts }),
      redact: ledgerRedactor({
        secretValues: [
          inputs.databaseUrl,
          inputs.environment.REDIS_URL,
          ...targets.map((target) => target.url),
        ],
      }),
    });
    return await use({ runner, release, withClickHouse: targets.length > 0 });
  } finally {
    await shared?.close();
  }
}

/** One upgrade run, narrated from its first line to its closing lines; never throws a failure. */
export function runImageUpgrade({
  inputs,
  signal,
}: {
  inputs: ImageUpgradeInputs;
  signal: AbortSignal;
}): Promise<UpgradeOutcome> {
  return withImageUpgradeRunner({
    inputs,
    use: async ({ runner, withClickHouse }) => {
      if (!withClickHouse) writeUpgradeLine(noClickHouseLine());
      const outcome = await runner.run({ signal });
      const baseHost = inputs.environment.BASE_HOST;
      for (const line of closingLines({ outcome, baseHost })) writeUpgradeLine(line);
      return outcome;
    },
  });
}
