import { setTimeout as sleep } from "node:timers/promises";

import { generate } from "@langwatch/ksuid";

import { BLOCKING_STEP_DEADLINE_MS, stepDeadline } from "../background/step-deadline.ts";
import { imageContractArchives, imagePrismaSql } from "../gate/image-tree.ts";
import { UpgradeLedgerSeedService, withReinferred } from "../ledger-seed.service.ts";
import { LEDGER_LOCK_TIMEOUT_MS } from "../ledger-tables.ts";
import { UpgradeLedgerRepository } from "../ledger.repository.ts";
import type { UpcastStepInput, UpgradeRun, UpgradeStep, UpgradeStepStatus } from "../ledger.ts";
import { compareReleases } from "../manifest/manifest.ts";
import type { ManifestStep, ReleaseManifest } from "../manifest/manifest.ts";
import { planInstallation } from "../plan/plan-installation.ts";
import { orderAfter, type PlannedRelease, type UpgradePlan } from "../plan/plan-upgrade.ts";
import type { UpgradeClickHouse, UpgradePostgres } from "../ports.ts";
import type { UpgradeStatus } from "../reader/reader.schema.ts";
import { createUpgradeReader } from "../reader/reader.service.ts";
import { prismaSteps, readPrismaMigrations } from "../seed-sources.ts";
import type { MigrationStep } from "../step/migration-step.ts";
import { type LedgerTextRedactor, StepLogTail } from "../step/step-log.ts";
import { type DifferingIndex, differingPrebuiltIndexes } from "../stepping/prebuilt-indexes.ts";
import {
  findHandAppliedSql,
  isRerunnablePrismaMigration,
} from "../stepping/rerunnable-migrations.ts";
import { ContractArchiveRepository } from "./contract-archive/contract-archive.repository.ts";
import {
  ContractArchiveError,
  type ContractArchiveEntry,
  ContractArchiveService,
} from "./contract-archive/contract-archive.service.ts";
import { blocksRelease, type HeldTargets, newlyHeld, withHeldReports } from "./held-targets.ts";
import { UPGRADE_READ_HINT_PATH, type UpgradeReadHintPublish } from "./run-hint.ts";
import { redactSecrets, resolveCommand, UPGRADE_RUN_COMMAND, UpgradeRunLog } from "./run-log.ts";
import { RunPhases, type UpgradePhaseChange, type UpgradePhaseOutcome } from "./run-phases.ts";
import { DEFAULT_LEASE_TIMING, holdUpgradeLease, type UpgradeLeaseTiming } from "./runner-lease.ts";
import {
  OPERATOR_RETRY_KEY,
  type RegisteredStep,
  UpgradeRunnerRepository,
} from "./runner-ledger.repository.ts";
import {
  isPrivateTarget,
  type SchemaTargetReport,
  type UpgradeReconciler,
  type UpgradeRunnerLog,
  type UpgradeSchemaApplier,
} from "./schema-applier.ts";
import { type UpgradeOutcome, upgradeOutcome, UpgradeRunFailure } from "./upgrade-outcome.ts";

/** `lock_timeout` about 2 s, so live reads never queue long behind DDL (Alex, 2026-10-09). */
export const DEFAULT_LOCK_TIMEOUT_MS = LEDGER_LOCK_TIMEOUT_MS;
export const DEFAULT_RETRY = { attempts: 3, backoffMs: 2_000 };

export interface UpgradeRunnerOptions {
  postgres: UpgradePostgres;
  /** The shared ClickHouse, read only to seed an empty ledger from `goose_db_version`. */
  clickhouse?: UpgradeClickHouse;
  /** The image's release (its newest manifest), every step its tree declares and, to re-run a
   *  failed one, every Prisma folder it contains (`0_init` too; UD-F2). */
  image: {
    release: string | null;
    steps: readonly ManifestStep[];
    prismaFolders?: readonly string[];
  };
  releases: { manifests: readonly ReleaseManifest[] };
  applier: UpgradeSchemaApplier;
  /** The ledger name of every ClickHouse target the environment configures; a private one with
   *  no target rows yet is seeded pending on every shipped step, so it reads behind. */
  clickhouseTargets?: readonly string[];
  codeSteps?: readonly MigrationStep[];
  /** A Prisma folder's SQL, for the pre-built index check; else read from the image. */
  prismaSql?: (args: { folder: string }) => string | null;
  /** Contract ids, each with the tables its `-- archive:` notes name; else read from the image. */
  archives?: ReadonlyMap<string, readonly string[]>;
  reconcilers?: readonly UpgradeReconciler[];
  /** Called once the schema and blocking steps are done, before the reconcilers (T0-F11). */
  onBlockingDone?: () => void;
  /** The image's declared event upcasts and the stored events each covers (record §9). */
  upcasts?: () => Promise<readonly UpcastStepInput[]>;
  identity: { image: string; host: string };
  log: UpgradeRunnerLog;
  lease?: Partial<UpgradeLeaseTiming>;
  lockTimeoutMs?: number;
  retry?: { attempts: number; backoffMs: number };
  /** Publishes the read hint for each phase change and the finish (round 8, U2-LIVE). */
  hints?: UpgradeReadHintPublish;
  /** Masks what the ledger stores; `ledgerRedactor` with the store URLs, else pattern-only. */
  redact?: LedgerTextRedactor;
}

type LedgerFacts = readonly Pick<UpgradeStep, "id" | "status">[];
type TargetStatus = Extract<UpgradeStepStatus, "done" | "failed" | "pending">;

const isPrisma = (id: string) => id.startsWith("prisma:");
const isGoose = (id: string) => id.startsWith("clickhouse:");
const describeError = (error: unknown) =>
  redactSecrets(error instanceof Error ? error.message : String(error));

/** Every step the image ships, each with the release that shipped it (null: unreleased). */
function shippedSteps({
  image,
  manifests,
}: Pick<UpgradeRunnerOptions, "image"> & { manifests: readonly ReleaseManifest[] }) {
  const atOrBelowImage = (release: string) =>
    !image.release || compareReleases({ left: release, right: image.release }) <= 0;
  const released = new Set(manifests.flatMap((manifest) => manifest.steps.map((step) => step.id)));
  const shipped: RegisteredStep[] = manifests
    .filter((manifest) => atOrBelowImage(manifest.release))
    .flatMap((manifest) => manifest.steps.map((step) => ({ ...step, release: manifest.release })));
  const unreleased = image.steps.filter((step) => !released.has(step.id));
  return [...shipped, ...unreleased.map((step) => ({ ...step, release: null }))];
}

/** The latest succeeded upgrade that recorded a release: what the database was last brought to. */
function lastRecordedUpgrade({ runs }: { runs: readonly UpgradeRun[] }): UpgradeRun | undefined {
  return runs
    .filter((run) => run.kind === "upgrade" && run.outcome === "succeeded" && run.release)
    .toSorted((left, right) => right.startedAt.getTime() - left.startedAt.getTime())[0];
}

/** One ClickHouse target's status for an open step; only the first missing step is blamed. */
function targetStatus({
  target,
  id,
  blamed,
}: {
  target: Extract<SchemaTargetReport, { engine: "clickhouse" }>;
  id: string;
  blamed: boolean;
}): TargetStatus {
  if (target.applied?.has(id) === true) return "done";
  if (!target.ok && !blamed) return "failed";
  return "pending";
}

/**
 * A schema apply that reported success but left open steps unapplied (a skipped engine, no
 * ClickHouse target, an unreadable goose history): the run fails rather than succeed behind.
 * Spec: packages/upgrade/specs/unfinished-steps.feature.
 */
function unfinishedSchemaFailure({
  unfinished,
  reports,
}: {
  unfinished: readonly string[];
  reports: readonly SchemaTargetReport[];
}): UpgradeRunFailure {
  const noClickHouse =
    unfinished.some(isGoose) && !reports.some((report) => report.engine === "clickhouse");
  const why = noClickHouse ? "; no ClickHouse target was configured" : "";
  return new UpgradeRunFailure(
    "schema_failed",
    `schema steps did not end done after the apply: ${unfinished.join(", ")}${why}`,
    { steps: [...unfinished] },
  );
}

/** Once no Prisma migration failed: a failing target fails the run, else an unfinished step. */
function schemaFailure({
  reports,
  unfinished,
}: {
  reports: readonly SchemaTargetReport[];
  unfinished: readonly string[];
}): UpgradeRunFailure | null {
  const failing = reports.filter((report) => !report.ok);
  if (failing.length === 0) {
    return unfinished.length > 0 ? unfinishedSchemaFailure({ unfinished, reports }) : null;
  }
  const named = failing.map(
    (report) => `${report.target} (${redactSecrets(report.error ?? "no error given")})`,
  );
  return new UpgradeRunFailure("schema_failed", `schema failed on ${named.join(", ")}`, {
    targets: failing.map(({ target, error }) => ({
      target,
      error: error === null ? null : redactSecrets(error),
    })),
  });
}

/** Why the runner did not resolve a failed migration itself; null when it was never asked to. */
type NotResolvedReason =
  | "below-marker"
  | "not-shipped"
  | "no-resolver"
  | { resolveError: string }
  | { handApplied: string };

const NOT_RESOLVED: Record<Exclude<NotResolvedReason, object>, string> = {
  "below-marker":
    "It is not newer than the re-runnable marker, so the upgrade does not re-run it unasked. " +
    "If nothing of it remains, press Retry on its step in Ops > Upgrades and the next upgrade " +
    "marks it rolled back and applies it again. ",
  "not-shipped": "This image does not ship it, so the upgrade cannot re-run it. ",
  "no-resolver": "",
};

function prismaFailure({
  names,
  reason,
}: {
  names: readonly string[];
  reason: NotResolvedReason;
}): UpgradeRunFailure {
  if (typeof reason === "object" && "handApplied" in reason)
    return handAppliedFailure({ name: reason.handApplied });
  const command = resolveCommand(names[0]!);
  const why =
    typeof reason === "object"
      ? `Marking it rolled back failed: ${redactSecrets(reason.resolveError)}. `
      : NOT_RESOLVED[reason];
  return new UpgradeRunFailure(
    "failed_prisma_migration",
    `Prisma migration ${names.join(", ")} failed and is recorded as failed in _prisma_migrations. ` +
      why +
      `Check what it left behind. Then, in packages/prisma-client with DATABASE_URL set, run ` +
      `"${command}" if nothing of it remains, or "prisma migrate resolve --applied ${names[0]}" ` +
      `if you completed it by hand. A waiting worker sees the row resolved and runs the upgrade ` +
      `again by itself within 10 s; or run \`${UPGRADE_RUN_COMMAND}\`.`,
    { migrations: names, command },
  );
}

/** Pending folders whose `IF NOT EXISTS` index another index of that name would skip (T9-F3). */
function prebuiltIndexFailure({ differing }: { differing: readonly DifferingIndex[] }) {
  const each = differing.map(
    ({ migration, name, table, should, is }) =>
      `Prisma migration ${migration} creates index "${name}" on "${table}" if it does not exist, ` +
      `but an index of that name already exists and differs. It should be: ${should}. It is: ${is}.`,
  );
  const names = differing.map(({ name }) => `"${name}"`).join(", ");
  return new UpgradeRunFailure(
    "prebuilt_index_differs",
    `${each.join(" ")} The migration would skip it and leave the table without the index it ` +
      `expects, so nothing was applied. Drop or rename ${names} (for example ALTER INDEX ` +
      `"${differing[0]!.name}" RENAME TO "${differing[0]!.name}_prebuilt"); nothing drops it for ` +
      `you. Then this worker runs the upgrade again by itself within 5 minutes, or run ` +
      `\`${UPGRADE_RUN_COMMAND}\` now.`,
    { indexes: differing.map((index) => ({ ...index })) },
  );
}

/** A two-statement main folder that may be half applied: the SQL a person runs, then upgrade. */
function handAppliedFailure({ name }: { name: string }): UpgradeRunFailure {
  const sql = findHandAppliedSql({ name });
  return new UpgradeRunFailure(
    "failed_prisma_migration",
    `Prisma migration ${name} failed and is recorded as failed in _prisma_migrations. It runs ` +
      `two statements and may have stopped between them, so the upgrade never re-runs it. Run ` +
      `this SQL on the database; it completes the migration whatever it left behind and records ` +
      `it applied. Then upgrade again: ${sql.join(" ")}`,
    { migrations: [name], sql },
  );
}

/** A resolved migration that failed on every attempt; `again` when the next upgrade re-runs it. */
function rerunnableFailure({
  names,
  attempts,
  error,
  again,
}: {
  names: readonly string[];
  attempts: number;
  error: string | null;
  again: boolean;
}): UpgradeRunFailure {
  const detail = redactSecrets(error ?? "no error given");
  const next = again
    ? `It is re-runnable, so the next upgrade marks it rolled back and applies it again; no ` +
      `prisma migrate resolve is needed. Fix the cause first.`
    : `It was re-run on an operator's Retry, which this run spent. Fix the cause, then press ` +
      `Retry on its step in Ops > Upgrades again.`;
  return new UpgradeRunFailure(
    "rerunnable_migration_failed",
    `Prisma migration ${names.join(", ")} failed on all ${attempts} attempts: ${detail}. ${next}`,
    { migrations: names, attempts, error: detail },
  );
}

/** What lets a run re-run a migration below the marker: a first install, or an operator Retry. */
type RerunPermit = { firstInstall: boolean; retried: ReadonlySet<string> };

/**
 * A first install is a run planned fresh while no upgrade ever succeeded: every Prisma row is this
 * installation's own, so a failed folder re-runs whatever the marker. A Retry is read from the
 * step's report (`OPERATOR_RETRY_KEY`). specs/upgrade/rerunnable-migrations.feature.
 */
function permitOf({
  plan,
  steps,
  runs,
}: {
  plan: UpgradePlan;
  steps: readonly UpgradeStep[];
  runs: readonly UpgradeRun[];
}): RerunPermit {
  const succeeded = runs.some((run) => run.kind === "upgrade" && run.outcome === "succeeded");
  const retried = steps.filter(
    (step) => isPrisma(step.id) && step.report?.[OPERATOR_RETRY_KEY] !== undefined,
  );
  return {
    firstInstall: plan.outcome === "planned" && plan.fresh && !succeeded,
    retried: new Set(retried.map((step) => step.id.slice("prisma:".length))),
  };
}

/**
 * `pnpm task upgrade` (rethink 6.4, 6.7, 6.11; blitz 3.2, D4): under the runner lease, seeds an
 * empty ledger, plans, applies release by release from wherever it is, records each target,
 * runs blocking steps, then the reconcilers. specs/upgrade/upgrade-command.feature.
 */
export class UpgradeRunnerService {
  private readonly ledger: UpgradeLedgerRepository;
  private readonly runner: UpgradeRunnerRepository;
  private readonly timing: UpgradeLeaseTiming;
  private readonly codeSteps: ReadonlyMap<string, MigrationStep>;
  private readonly shipped: RegisteredStep[];
  private readonly narrate: UpgradeRunLog;
  private readonly shippedIds: ReadonlySet<string>;
  private readonly shippedFolders: ReadonlySet<string>;
  private readonly archiver: ContractArchiveService;
  private resolved: { migration: string; attempt: number }[] = [];
  private permit: RerunPermit = { firstInstall: false, retried: new Set() };
  private held: HeldTargets = new Map();

  private constructor(private readonly options: UpgradeRunnerOptions) {
    const redact = options.redact ?? redactSecrets;
    this.ledger = UpgradeLedgerRepository.create({ postgres: options.postgres, redact });
    this.runner = UpgradeRunnerRepository.create({ postgres: options.postgres, redact });
    this.timing = { ...DEFAULT_LEASE_TIMING, ...options.lease };
    this.codeSteps = new Map((options.codeSteps ?? []).map((step) => [step.id, step]));
    this.shipped = shippedSteps({ image: options.image, manifests: options.releases.manifests });
    this.narrate = new UpgradeRunLog(options.log);
    this.shippedIds = new Set(this.shipped.map((step) => step.id));
    this.shippedFolders = new Set(options.image.prismaFolders ?? []);
    const store = ContractArchiveRepository.create({ postgres: options.postgres });
    this.archiver = ContractArchiveService.create({ store });
  }

  static create(options: UpgradeRunnerOptions): UpgradeRunnerService {
    return new UpgradeRunnerService(options);
  }

  /** Narrated from first line to last: specs/upgrade/upgrade-logging.feature. */
  async run({ signal }: { signal: AbortSignal }): Promise<UpgradeOutcome> {
    this.narrate.begin();
    const fresh = !(await this.runner.prismaHistoryExists());
    if (fresh) this.narrate.firstRun();
    const outcome = await this.runOnce({ signal, fresh });
    this.narrate.finished({ outcome, fresh });
    return outcome;
  }

  private async runOnce({
    signal,
    fresh,
  }: {
    signal: AbortSignal;
    fresh: boolean;
  }): Promise<UpgradeOutcome> {
    const ledgerFailed = await this.prepareLedger();
    if (ledgerFailed) return ledgerFailed;
    const { identity } = this.options;
    const owner = `${identity.host}:${generate("upgradelease").toString()}`;
    const held = await holdUpgradeLease({
      ledger: this.ledger,
      runner: this.runner,
      identity: { ...identity, owner },
      timing: this.timing,
      log: this.narrate,
      signal,
      work: (args) => this.upgradeUnderLease({ ...args, fresh }),
    });
    if (!held.acquired) return this.leaseRefused({ holder: held.holder });
    if (!held.lost) return held.result;
    const { message, runId, detail } = held.result;
    return upgradeOutcome({ code: "lease_lost", message: `lease lost: ${message}`, runId, detail });
  }

  /**
   * The ledger schema and its tables, lease included, exist before anything else on every
   * database (round 21), so Prisma's first deploy runs under the lease like any other step.
   */
  private async prepareLedger(): Promise<UpgradeOutcome | null> {
    const startedAt = performance.now();
    try {
      const tables = await this.ledger.createTables();
      this.narrate.ledgerReady({ schema: tables.schema, startedAt });
      return null;
    } catch (failure) {
      const error = redactSecrets(failure instanceof Error ? failure.message : String(failure));
      this.narrate.ledgerFailed({ error });
      return upgradeOutcome({
        code: "schema_failed",
        message:
          `the upgrade ledger could not be created in its own Postgres schema: ${error}. ` +
          "The DATABASE_URL role needs CREATE on the database, or the schema created for it beforehand",
        detail: { targets: [{ target: "postgres", error }] },
      });
    }
  }

  /** What `upgrade plan` prints: read-only, no lease, nothing written, archives a dry run. */
  async plan(): Promise<{
    installed: string | null;
    plan: UpgradePlan;
    archives: ContractArchiveEntry[];
  }> {
    const planned = this.planFrom(await this.readLedger());
    const archives =
      planned.plan.outcome === "planned"
        ? await this.archiveContracts({ releases: planned.plan.releases, runId: null })
        : [];
    return { ...planned, archives };
  }

  /** What `upgrade status` prints, read by the reader. */
  async status(): Promise<UpgradeStatus> {
    return createUpgradeReader({
      postgres: this.options.postgres,
      image: { release: this.options.image.release ?? "unreleased", steps: this.shipped },
    }).status();
  }

  private leaseRefused({
    holder,
  }: {
    holder: { owner: string; host: string; image: string } | null;
  }) {
    const waited = `gave up after ${this.timing.waitMs} ms`;
    return upgradeOutcome({
      code: "lease_not_acquired",
      message: holder
        ? `another upgrade holds the lease: ${holder.owner} on ${holder.host} (${holder.image}); ${waited}`
        : `the upgrade lease stayed taken; ${waited}`,
      detail: holder
        ? { holder: { owner: holder.owner, host: holder.host, image: holder.image } }
        : {},
    });
  }

  /**
   * The ledger as the planner reads it, inferred rows re-read as a run re-infers them; an empty or
   * absent one is read from the tools' records.
   */
  private async readLedger(): Promise<{ steps: LedgerFacts; runs: UpgradeRun[] }> {
    const { postgres, clickhouse } = this.options;
    const history = await UpgradeLedgerSeedService.create({ postgres, clickhouse }).readHistory();
    if ((await this.runner.ledgerExists()) && (await this.succeededSeed())) {
      const steps = withReinferred({ steps: await this.ledger.findSteps(), history });
      return { steps, runs: await this.ledger.findRuns() };
    }
    return { steps: history, runs: [] };
  }

  /** A seed that failed or was cut after its run row seeds again, never reads as fresh. */
  private async succeededSeed(): Promise<UpgradeRun | undefined> {
    const runs = await this.ledger.findRuns();
    return runs.find((run) => run.kind === "seed" && run.outcome === "succeeded");
  }

  /**
   * Seeds the ledger once, then re-infers its seeded rows every run, so a refused install that
   * upgraded with an image older than the ledger is planned from where it is now.
   * Spec: packages/upgrade/specs/ledger-seed.feature.
   */
  private async seedOrReinfer(): Promise<void> {
    const { postgres, clickhouse } = this.options;
    const seeder = UpgradeLedgerSeedService.create({ postgres, clickhouse });
    const seed = await this.succeededSeed();
    if (seed) await seeder.reinfer({ seedRunId: seed.id });
    else await seeder.seed();
  }

  /** `fresh`: this runner found no Prisma history, so what the ledger holds it applied itself. */
  private planFrom({
    steps,
    runs,
    fresh = false,
  }: {
    steps: LedgerFacts;
    runs: readonly UpgradeRun[];
    fresh?: boolean;
  }) {
    const { image, releases } = this.options;
    return planInstallation({ image, releases, steps, runs, fresh });
  }

  private async upgradeUnderLease({
    signal,
    fresh,
  }: {
    signal: AbortSignal;
    fresh: boolean;
  }): Promise<UpgradeOutcome> {
    await this.seedOrReinfer();
    const before = { steps: await this.ledger.findSteps(), runs: await this.ledger.findRuns() };
    const { installed, plan } = this.planFrom({ ...before, fresh });
    this.permit = permitOf({ plan, ...before });
    const run = await this.ledger.startRun({ kind: "upgrade" });
    await this.runner.recordRunPlan({ runId: run.id, release: this.options.image.release, plan });
    this.narrate.planned({ runId: run.id, installed, plan });
    const phases = this.phasesOf({ runId: run.id });
    try {
      const report = await this.applyPlan({ plan, before, runId: run.id, signal, phases });
      const upcasts = await this.options.upcasts?.();
      if (upcasts) await this.ledger.recordUpcastSteps({ runId: run.id, steps: upcasts });
      await this.finishRun({ runId: run.id, outcome: "succeeded", report, phases });
      const message = `upgraded to ${this.options.image.release ?? "this image"}`;
      return upgradeOutcome({ code: "done", message, runId: run.id, detail: report });
    } catch (error) {
      const failure =
        error instanceof UpgradeRunFailure
          ? error
          : new UpgradeRunFailure(signal.aborted ? "lease_lost" : "failed", describeError(error));
      const { code, message, detail } = failure;
      await phases.finish({ outcome: "failed" });
      const report = { code, error: message, ...detail };
      await this.finishRun({ runId: run.id, outcome: "failed", report, phases });
      return upgradeOutcome({ code, message, runId: run.id, detail });
    }
  }

  /** The run's phases: each change rewrites the moving report and raises a read hint. */
  private phasesOf({ runId }: { runId: string }): RunPhases {
    return new RunPhases({
      runId,
      now: () => this.runner.databaseNow(),
      onChange: async ({ phase, phases }: UpgradePhaseChange) => {
        this.narrate.phase({ phase });
        await this.runner.recordRunReport({ runId, report: { phases } });
        const { name, release = null, outcome } = phase;
        await this.hint({ runId, phase: name, release, outcome });
      },
    });
  }

  /** Writes the final report with its phases, then raises the run's last hint. */
  private async finishRun({
    runId,
    outcome,
    report,
    phases,
  }: {
    runId: string;
    outcome: "succeeded" | "failed";
    report: Record<string, unknown>;
    phases: RunPhases;
  }): Promise<void> {
    await this.ledger.finishRun({
      runId,
      outcome,
      report: { ...report, phases: phases.list(), logTail: this.narrate.tail() },
    });
    await this.hint({ runId, phase: null, release: this.options.image.release, outcome });
  }

  /** A hint that cannot be published is a warning: the page refreshes on the next one. */
  private async hint({
    runId,
    phase,
    release,
    outcome,
  }: {
    runId: string;
    phase: UpgradePhaseChange["phase"]["name"] | null;
    release: string | null;
    outcome: UpgradePhaseOutcome;
  }): Promise<void> {
    const { hints } = this.options;
    const log = this.narrate;
    if (!hints) return;
    try {
      await hints({ path: UPGRADE_READ_HINT_PATH, runId, phase, release, outcome });
    } catch (error) {
      log.warn("upgrade read hint not published", { runId, phase, error: describeError(error) });
    }
  }

  private async applyPlan({
    plan,
    before,
    runId,
    signal,
    phases,
  }: {
    plan: UpgradePlan;
    before: { steps: UpgradeStep[]; runs: UpgradeRun[] };
    runId: string;
    signal: AbortSignal;
    phases: RunPhases;
  }): Promise<Record<string, unknown>> {
    await phases.start({ name: "preflight" });
    this.resolved = [];
    this.held = new Map();
    const retried = [...this.permit.retried].map((name) => `prisma:${name}`);
    await this.runner.clearOperatorRetry({ ids: retried });
    await this.runner.registerSteps({ steps: this.shipped });
    await this.resolveLeftFailures({ signal, runId });
    await this.seedUnrecordedTargets();
    await this.retryFailedBackgroundSteps({ runId });
    const reopened = await this.reopenAfterRollback({ ...before });
    await this.runner.setStatus({ ids: plan.notNeeded, status: "not-needed", runId });
    await phases.end({ name: "preflight", outcome: "succeeded" });
    const recorded = new Map(before.steps.map((step) => [step.id, step]));
    const applied: string[] = [];
    await this.refuseMisorderedSteps();
    await this.refuseDifferingIndexes({ plan });
    const declared = this.options.archives ?? imageContractArchives();
    const archived: ContractArchiveEntry[] = [];
    for (const [index, release] of plan.releases.entries()) {
      signal.throwIfAborted();
      if (release.schema.length > 0) {
        const ahead = plan.releases.slice(index);
        archived.push(...(await this.archiveContracts({ releases: ahead, runId, declared })));
        await this.applySchema({ release, signal, runId, phases });
        applied.push(...release.schema);
      }
      for (const id of release.blocking) {
        await this.runBlockingStep({ id, recorded: recorded.get(id), signal, runId });
        applied.push(id);
      }
    }
    await this.catchUpTargets({ signal });
    this.options.onBlockingDone?.();
    await phases.start({ name: "reconcile" });
    await this.runReconcilers({ signal });
    await phases.end({ name: "reconcile", outcome: "succeeded" });
    const kept = archived.filter((entry) => entry.state === "copied");
    return {
      applied,
      notNeeded: plan.notNeeded,
      reopened,
      resolved: this.resolved,
      archived: kept,
      ...(this.held.size > 0 ? { heldTargets: [...this.held.keys()] } : {}),
    };
  }

  /**
   * Archive-or-fail (Alex, 2026-10-09): before any schema apply, every table a contract still
   * ahead archives is copied and checked, since an applier that cannot step applies them all at
   * once. A failure fails the contract step; `runId` null is the dry run.
   */
  private async archiveContracts({
    releases,
    runId,
    declared = this.options.archives ?? imageContractArchives(),
  }: {
    releases: readonly PlannedRelease[];
    runId: string | null;
    declared?: ReadonlyMap<string, readonly string[]>;
  }): Promise<ContractArchiveEntry[]> {
    const entries: ContractArchiveEntry[] = [];
    for (const { release, schema } of releases) {
      for (const step of schema) {
        const tables = declared.get(step);
        if (!tables) continue;
        try {
          const dryRun = runId === null;
          entries.push(...(await this.archiver.archive({ step, tables, release, dryRun })));
        } catch (error) {
          if (!(error instanceof ContractArchiveError) || runId === null) throw error;
          const lastError = error.message;
          await this.runner.setStatus({ ids: [step], status: "failed", runId, lastError });
          this.narrate.warn(lastError, {
            phase: "archive",
            step,
            next: "nothing was dropped; fix what the error names, then run the upgrade again",
          });
          throw new UpgradeRunFailure("step_failed", lastError, { step, error: error.code });
        }
      }
    }
    return entries;
  }

  /** Round 21, S3-RETRY: the failed rows the runner may resolve, or why it may not. */
  private resolvable({ names }: { names: readonly string[] }): NotResolvedReason | null {
    const handApplied = names.find((name) => findHandAppliedSql({ name }).length > 0);
    if (handApplied !== undefined) return { handApplied };
    if (!names.every((name) => this.mayRerun({ name }))) return "below-marker";
    if (!names.every((name) => this.ships({ name }))) return "not-shipped";
    if (!this.options.applier.resolveRolledBack) return "no-resolver";
    return null;
  }

  /** Named by a release file or the image's step list, or a folder the image contains (UD-F2). */
  private ships({ name }: { name: string }): boolean {
    return this.shippedIds.has(`prisma:${name}`) || this.shippedFolders.has(name);
  }

  /** Re-runnable, a first install (UD12-F2) or an operator's Retry (Alex, 2026-10-11). */
  private mayRerun({ name }: { name: string }): boolean {
    const { firstInstall, retried } = this.permit;
    return isRerunnablePrismaMigration({ name }) || firstInstall || retried.has(name);
  }

  private whyRerun({ name }: { name: string }): string {
    if (isRerunnablePrismaMigration({ name })) return "is re-runnable";
    return this.permit.firstInstall ? "this is a first install" : "an operator pressed Retry on it";
  }

  /** Before any folder applies, so a refusal leaves nothing half done; reads every pending one. */
  private async refuseDifferingIndexes({ plan }: { plan: UpgradePlan }): Promise<void> {
    const read = this.options.prismaSql ?? imagePrismaSql;
    const folders = plan.releases.flatMap((release) =>
      release.schema.filter(isPrisma).flatMap((id) => {
        const folder = id.slice("prisma:".length);
        const sql = read({ folder });
        return sql === null ? [] : [{ name: folder, sql }];
      }),
    );
    const differing = await differingPrebuiltIndexes({ postgres: this.options.postgres, folders });
    if (differing.length > 0) throw prebuiltIndexFailure({ differing });
  }

  /** Marks each failed migration rolled back; refuses by name when one cannot be. */
  private async resolveRolledBack({
    names,
    signal,
  }: {
    names: readonly string[];
    signal: AbortSignal;
  }): Promise<Map<string, number>> {
    const reason = this.resolvable({ names });
    if (reason !== null) throw prismaFailure({ names, reason });
    const elapsed = new Map<string, number>();
    for (const migration of names) {
      const startedAt = performance.now();
      const report = await this.options.applier.resolveRolledBack!({ migration, signal });
      if (!report.ok)
        throw prismaFailure({
          names: [migration],
          reason: { resolveError: report.error ?? "no error given" },
        });
      elapsed.set(migration, Math.round(performance.now() - startedAt));
    }
    return elapsed;
  }

  /**
   * A failed row an earlier run left: resolved when it may re-run, else the run stops naming it
   * and its step reads failed again, so Ops > Upgrades shows it and the worker does not spin.
   */
  private async resolveLeftFailures({
    signal,
    runId,
  }: {
    signal: AbortSignal;
    runId: string;
  }): Promise<void> {
    const failed = await this.failedPrismaMigrations();
    if (failed.length === 0) return;
    try {
      const elapsed = await this.resolveRolledBack({ names: failed, signal });
      for (const [migration, resolveMs] of elapsed) {
        this.resolved.push({ migration, attempt: 0 });
        const because = this.whyRerun({ name: migration });
        this.narrate.resolvedBeforeApply({ migration, resolveMs, because });
      }
    } catch (error) {
      if (!(error instanceof UpgradeRunFailure)) throw error;
      const ids = failed.map((name) => `prisma:${name}`).filter((id) => this.shippedIds.has(id));
      await this.runner.setStatus({ ids, status: "failed", runId, lastError: error.message });
      throw error;
    }
  }

  private async failedPrismaMigrations(): Promise<string[]> {
    const rows = await readPrismaMigrations({ postgres: this.options.postgres });
    return prismaSteps({ rows })
      .filter((step) => step.status === "failed")
      .map((step) => step.id.slice("prisma:".length));
  }

  private async applySchema({
    release,
    signal,
    runId,
    phases,
  }: {
    release: PlannedRelease;
    signal: AbortSignal;
    runId: string;
    phases: RunPhases;
  }): Promise<void> {
    const engines = [
      { name: "postgres-schema", open: release.schema.filter(isPrisma) },
      { name: "clickhouse-schema", open: release.schema.filter(isGoose) },
    ] as const;
    for (const { name, open } of engines) {
      if (open.length > 0) await phases.start({ name, release: release.release });
    }
    const { reports, attempts } = await this.applyWithRetry({ release, signal });
    const prismaDone = await this.recordPrisma({ open: engines[0].open, runId });
    const gooseDone = await this.recordClickHouse({ open: engines[1].open, reports, runId });
    const done = new Set([...prismaDone, ...gooseDone]);
    const unfinished = release.schema.filter((id) => !done.has(id));
    const failedPrisma = await this.failedPrismaMigrations();
    const held = this.held;
    const failedOn = (engine: SchemaTargetReport["engine"]) =>
      reports.some((report) => report.engine === engine && blocksRelease({ report, held }));
    const postgresFailed =
      failedPrisma.length > 0 || failedOn("postgres") || unfinished.some(isPrisma);
    const clickhouseFailed = failedOn("clickhouse") || unfinished.some(isGoose);
    const outcome = (failed: boolean) => (failed ? "failed" : "succeeded");
    await phases.end({ name: "postgres-schema", outcome: outcome(postgresFailed) });
    await phases.end({ name: "clickhouse-schema", outcome: outcome(clickhouseFailed) });
    await this.stampPhaseTiming({ phases, name: "postgres-schema", ids: prismaDone });
    await this.stampPhaseTiming({ phases, name: "clickhouse-schema", ids: gooseDone });
    if (failedPrisma.length > 0) {
      const reason = this.resolvable({ names: failedPrisma });
      if (reason !== null) throw prismaFailure({ names: failedPrisma, reason });
      const error = reports.find((report) => report.engine === "postgres" && !report.ok)?.error;
      const again = failedPrisma.every(
        (name) => isRerunnablePrismaMigration({ name }) || this.permit.firstInstall,
      );
      throw rerunnableFailure({ names: failedPrisma, attempts, error: error ?? null, again });
    }
    const blocking = reports.filter((report) => report.ok || blocksRelease({ report, held }));
    const failure = schemaFailure({ reports: blocking, unfinished });
    if (failure) throw failure;
  }

  /** A schema step's row carries the start and finish of the phase that applied it (T0-F4). */
  private async stampPhaseTiming({
    phases,
    name,
    ids,
  }: {
    phases: RunPhases;
    name: "postgres-schema" | "clickhouse-schema";
    ids: readonly string[];
  }): Promise<void> {
    const phase = phases.list().findLast((each) => each.name === name);
    if (ids.length === 0 || !phase?.finishedAt) return;
    const { startedAt, finishedAt } = phase;
    await this.runner.stampTiming({ ids, startedAt, finishedAt });
  }

  /**
   * Retries with backoff a failure that left no failed Prisma migration, or one whose failed
   * migrations are re-runnable, each marked rolled back first (round 21, S3-RETRY).
   */
  private async applyWithRetry({
    release,
    signal,
  }: {
    release: PlannedRelease;
    signal: AbortSignal;
  }): Promise<{ reports: readonly SchemaTargetReport[]; attempts: number }> {
    const { applier } = this.options;
    const log = this.narrate;
    const lockTimeoutMs = this.options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    const retry = this.options.retry ?? DEFAULT_RETRY;
    let resolvedLastAttempt: string[] = [];
    for (let attempt = 1; ; attempt++) {
      const skipTargets = new Set(this.held.keys());
      const applied = await applier.apply({
        release: release.release,
        lockTimeoutMs,
        signal,
        skipTargets,
      });
      this.hold({ reports: applied });
      const held = this.held;
      const reports = withHeldReports({ reports: applied, held });
      if (reports.every((report) => !blocksRelease({ report, held }))) {
        if (resolvedLastAttempt.length > 0)
          log.appliedAfterResolve({ migrations: resolvedLastAttempt, attempt });
        return { reports, attempts: attempt };
      }
      if (attempt >= retry.attempts) return { reports, attempts: attempt };
      const failed = await this.failedPrismaMigrations();
      if (failed.length > 0 && this.resolvable({ names: failed }) !== null)
        return { reports, attempts: attempt };
      const waitMs = retry.backoffMs * 2 ** (attempt - 1);
      resolvedLastAttempt = failed;
      if (failed.length > 0) {
        const retrying = { attempt, attempts: retry.attempts, waitMs };
        await this.resolveForRetry({ failed, reports, retrying, signal });
        await sleep(waitMs, undefined, { signal });
        continue;
      }
      log.warn(`schema apply failed without a failed migration; retrying in ${waitMs} ms`, {
        phase: "schema",
        waitingOn: "the retry backoff",
        attempt,
        waitMs,
        next: "nothing to do yet: a transient failure is retried",
      });
      await sleep(waitMs, undefined, { signal });
    }
  }

  /** Marks this attempt's failed re-runnable migrations rolled back and logs each by name. */
  private async resolveForRetry({
    failed,
    reports,
    retrying,
    signal,
  }: {
    failed: readonly string[];
    reports: readonly SchemaTargetReport[];
    retrying: { attempt: number; attempts: number; waitMs: number };
    signal: AbortSignal;
  }): Promise<void> {
    const error = reports.find((report) => report.engine === "postgres" && !report.ok)?.error;
    const elapsed = await this.resolveRolledBack({ names: failed, signal });
    for (const [migration, resolveMs] of elapsed) {
      this.resolved.push({ migration, attempt: retrying.attempt });
      const because = this.whyRerun({ name: migration });
      this.narrate.resolvedForRetry({
        migration,
        ...retrying,
        resolveMs,
        error: error ?? null,
        because,
      });
    }
  }

  private async recordPrisma({ open, runId }: { open: readonly string[]; runId: string }) {
    const rows = await readPrismaMigrations({ postgres: this.options.postgres });
    const prisma = new Map(prismaSteps({ rows }).map((step) => [step.id, step]));
    const done = open.filter((id) => prisma.get(id)?.status === "done");
    await this.runner.setStatus({ ids: done, status: "done", runId });
    for (const id of open.filter((each) => prisma.get(each)?.status === "failed")) {
      const lastError = prisma.get(id)?.lastError ?? null;
      await this.runner.setStatus({ ids: [id], status: "failed", runId, lastError });
    }
    return done;
  }

  /** Holds each newly failed private target and says so once (T7-F1). */
  private hold({ reports }: { reports: readonly SchemaTargetReport[] }): void {
    for (const [target, error] of newlyHeld({ reports, held: this.held }))
      this.holdTarget({ target, error });
  }

  private holdTarget({ target, error }: { target: string; error: string | null }): void {
    this.held.set(target, error);
    this.narrate.warn(
      `ClickHouse target ${target} failed and is held: only its organizations wait, the rest of the release goes on`,
      {
        phase: "schema",
        target,
        error: redactSecrets(error ?? "no error given"),
        waitingOn: "the target",
        next: "nothing to do once the target answers: a later pass catches it up; otherwise fix what the error names",
      },
    );
  }

  /** One target row per open step; only the target's first missing step is blamed. */
  private async writeTargetRows({
    target,
    open,
  }: {
    target: Extract<SchemaTargetReport, { engine: "clickhouse" }>;
    open: readonly string[];
  }): Promise<Map<string, TargetStatus>> {
    const statuses = new Map<string, TargetStatus>();
    let blamed = false;
    for (const id of open.toSorted()) {
      const status = targetStatus({ target, id, blamed });
      blamed ||= status === "failed";
      const lastError = status === "failed" ? target.error : null;
      const version = id.slice("clickhouse:".length);
      await this.ledger.upsertTarget({
        stepId: id,
        target: target.target,
        status,
        version,
        lastError,
      });
      statuses.set(id, status);
    }
    return statuses;
  }

  /**
   * D4: one target row per step and endpoint. The step is the aggregate of every target the run
   * did not hold, failed if any is; a held private target keeps its own rows (T7-F1).
   */
  private async recordClickHouse({
    open,
    reports,
    runId,
  }: {
    open: readonly string[];
    reports: readonly SchemaTargetReport[];
    runId: string;
  }): Promise<string[]> {
    const targets = reports.flatMap((report) => (report.engine === "clickhouse" ? [report] : []));
    if (targets.length === 0 || open.length === 0) return [];
    const statuses = new Map<string, TargetStatus[]>();
    for (const target of targets) {
      const rows = await this.writeTargetRows({ target, open });
      if (this.held.has(target.target)) continue;
      for (const [id, status] of rows) statuses.set(id, [...(statuses.get(id) ?? []), status]);
    }
    const failedOn = targets
      .filter((target) => !target.ok && !this.held.has(target.target))
      .map((target) => target.target);
    const done: string[] = [];
    for (const [id, perTarget] of statuses) {
      if (perTarget.includes("failed")) {
        const lastError = `failed on ${failedOn.join(", ")}`;
        await this.runner.setStatus({ ids: [id], status: "failed", runId, lastError });
      } else if (perTarget.every((status) => status === "done")) {
        await this.runner.setStatus({ ids: [id], status: "done", runId });
        done.push(id);
      }
    }
    return done;
  }

  private async runBlockingStep({
    id,
    recorded,
    signal,
    runId,
  }: {
    id: string;
    recorded: UpgradeStep | undefined;
    signal: AbortSignal;
    runId: string;
  }): Promise<void> {
    // An upcast settles by its drain, a tenant step by ops' pass (S6-WIRE); neither has code here.
    const kind = this.shipped.find((step) => step.id === id)?.kind;
    if (kind === "event-upcast" || kind === "tenant") return;
    const step = this.codeSteps.get(id);
    if (!step) {
      const lastError = `blocking step ${id} is in the plan but this image declares no such step`;
      await this.runner.setStatus({ ids: [id], status: "failed", runId, lastError });
      throw new UpgradeRunFailure("step_failed", lastError, { step: id });
    }
    await this.runner.markRunning({ id, runId });
    const resuming = (recorded?.report ?? null) !== null;
    this.narrate.stepStarted({ id, description: step.description, resuming });
    const minutes = BLOCKING_STEP_DEADLINE_MS / 60_000;
    const reason = `blocking step ${id} passed its ${minutes}-minute deadline`;
    const deadline = stepDeadline({ signal, deadlineMs: BLOCKING_STEP_DEADLINE_MS, reason });
    const stepLog = StepLogTail.create({
      redact: this.options.redact ?? redactSecrets,
      forward: (level, message, fields) => this.narrate[level](message, { step: id, ...fields }),
    });
    try {
      const report = await deadline.race(
        step.run({
          checkpoint: {
            resumeFrom: recorded?.report ?? null,
            save: ({ report: saved }) => this.runner.saveReport({ id, report: saved }),
          },
          dryRun: false,
          signal: deadline.signal,
          log: stepLog,
        }),
      );
      // A run that returns aborted stopped early: it stays running with its checkpoint (F-2).
      signal.throwIfAborted();
      const logTail = stepLog.tail();
      await this.runner.setStatus({ ids: [id], status: "done", runId, report, logTail });
      this.narrate.stepEnded({ id, error: null });
    } catch (error) {
      if (signal.aborted) throw error;
      const lastError = describeError(error);
      this.narrate.stepEnded({ id, error: lastError });
      stepLog.keepOnly({
        level: "warn",
        message: "blocking step failed",
        fields: { error: lastError },
      });
      const logTail = stepLog.tail();
      await this.runner.setStatus({ ids: [id], status: "failed", runId, lastError, logTail });
      throw new UpgradeRunFailure("step_failed", `blocking step ${id} failed: ${lastError}`, {
        step: id,
      });
    } finally {
      deadline.stop();
    }
  }

  /**
   * Refuses a background step that runs after an unknown step or in a cycle (STEP-AFTER). The
   * upgrade runs none of them: every background step runs on the worker once old writers are gone.
   */
  private async refuseMisorderedSteps(): Promise<void> {
    const settled = (await this.ledger.findSteps())
      .filter((step) => step.status === "done" || step.status === "not-needed")
      .map((step) => step.id);
    orderAfter({
      steps: this.shipped
        .filter((step) => step.mode === "background" && this.codeSteps.has(step.id))
        .map((step) => ({ id: step.id, after: this.codeSteps.get(step.id)?.after })),
      settled: new Set(settled),
    });
  }

  /** Plan 2026-10-08 F-3: each run gives failed background steps another try on the worker. */
  private async retryFailedBackgroundSteps({ runId }: { runId: string }): Promise<void> {
    const ids = await this.runner.resetFailedSteps({ mode: "background", runId });
    if (ids.length === 0) return;
    this.narrate.warn(`failed background steps set pending again: ${ids.join(", ")}`, {
      phase: "preflight",
      steps: ids,
      next: "nothing to do: the worker runs them again from their checkpoints",
    });
  }

  /** Q-U5 2 (default taken): an older image's run reopens newer releases' done background steps. */
  private async reopenAfterRollback({
    runs,
    steps,
  }: {
    runs: UpgradeRun[];
    steps: UpgradeStep[];
  }): Promise<string[]> {
    const current = this.options.image.release;
    const last = lastRecordedUpgrade({ runs })?.release;
    if (!current || !last || compareReleases({ left: current, right: last }) >= 0) return [];
    const newer = (release: string | null) =>
      release !== null && compareReleases({ left: release, right: current }) > 0;
    const reopened = steps
      .filter((step) => step.mode === "background" && step.status === "done" && newer(step.release))
      .map((step) => step.id);
    const reason = `reopened: image ${current} runs below the last upgrade to ${last}`;
    return this.runner.reopenDoneSteps({ ids: reopened, reason });
  }

  /**
   * A private target configured after the last release that shipped schema has no rows, so it
   * never reads behind and the catch-up never sees it. Its first run seeds it pending on every
   * shipped ClickHouse step; the catch-up below then applies them. A seeded target writes nothing.
   */
  private async seedUnrecordedTargets(): Promise<void> {
    const recorded = new Set(await this.ledger.findRecordedTargets());
    const unrecorded = (this.options.clickhouseTargets ?? []).filter(
      (target) => isPrivateTarget({ target }) && !recorded.has(target),
    );
    if (unrecorded.length === 0) return;
    const ids = [...this.shippedIds].filter(isGoose).toSorted();
    for (const target of unrecorded) {
      await this.ledger.seedTargetSteps({ target, stepIds: ids });
      this.narrate.info(`ClickHouse target ${target} is new and behind; this run catches it up`, {
        phase: "preflight",
        target,
        steps: ids.length,
      });
    }
  }

  /**
   * A target an earlier run held catches up here, once the plan is applied: one apply of every
   * step the image ships, recorded only on that target's rows. Still failing, it stays held and the
   * run goes on (Alex, 2026-10-11, T7-F1); the worker asks for another pass later.
   */
  private async catchUpTargets({ signal }: { signal: AbortSignal }): Promise<void> {
    const behind = (await this.ledger.findTargetsBehind()).filter(
      ({ stepId, target }) =>
        isPrivateTarget({ target }) && !this.held.has(target) && this.shippedIds.has(stepId),
    );
    if (behind.length === 0) return;
    const lockTimeoutMs = this.options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    const skipTargets = new Set(this.held.keys());
    const reports = await this.options.applier.apply({
      release: null,
      lockTimeoutMs,
      signal,
      skipTargets,
    });
    const targets = [...new Set(behind.map(({ target }) => target))];
    const caughtUp: string[] = [];
    for (const name of targets) {
      const report = reports.find((each) => each.engine === "clickhouse" && each.target === name);
      if (report?.engine !== "clickhouse") continue;
      const open = behind.filter(({ target }) => target === name).map(({ stepId }) => stepId);
      const rows = await this.writeTargetRows({ target: report, open });
      if ([...rows.values()].every((status) => status === "done")) caughtUp.push(name);
      else this.holdTarget({ target: name, error: report.error });
    }
    if (caughtUp.length > 0)
      this.narrate.info(`ClickHouse target ${caughtUp.join(", ")} caught up`, {
        phase: "schema",
        targets: caughtUp,
      });
  }

  private async runReconcilers({ signal }: { signal: AbortSignal }): Promise<void> {
    const failed: string[] = [];
    for (const reconciler of this.options.reconcilers ?? []) {
      signal.throwIfAborted();
      if (reconciler.target !== undefined && this.held.has(reconciler.target)) {
        this.narrate.warn(`reconciler ${reconciler.name} skipped: its target is held`, {
          phase: "reconcile",
          reconciler: reconciler.name,
          next: "nothing to do: it runs on the pass that catches the target up",
        });
        continue;
      }
      try {
        await reconciler.run({ signal });
      } catch (error) {
        this.narrate.warn(`reconciler ${reconciler.name} failed`, {
          phase: "reconcile",
          reconciler: reconciler.name,
          error: describeError(error),
          next: "the run fails after the remaining reconcilers; fix the named store, then run again",
        });
        failed.push(reconciler.name);
      }
    }
    if (failed.length === 0) return;
    throw new UpgradeRunFailure("reconciler_failed", `reconciler ${failed.join(", ")} failed`, {
      reconcilers: failed,
    });
  }
}

export function createUpgradeRunner(options: UpgradeRunnerOptions): UpgradeRunnerService {
  return UpgradeRunnerService.create(options);
}

export type UpgradeRunner = UpgradeRunnerService;
