import { setTimeout as sleep } from "node:timers/promises";

import { generate } from "@langwatch/ksuid";

import { UpgradeLedgerSeedService } from "../ledger-seed.service.ts";
import { UpgradeLedgerRepository } from "../ledger.repository.ts";
import type { UpgradeRun, UpgradeStep, UpgradeStepStatus } from "../ledger.ts";
import { compareReleases } from "../manifest/manifest.ts";
import type { LtsFloor, ManifestStep, ReleaseManifest } from "../manifest/manifest.ts";
import { type PlannedRelease, planUpgrade, type UpgradePlan } from "../plan/plan-upgrade.ts";
import type { UpgradeClickHouse, UpgradePostgres } from "../ports.ts";
import type { UpgradeStatus } from "../reader/reader.schema.ts";
import { createUpgradeReader } from "../reader/reader.service.ts";
import {
  gooseSteps,
  prismaSteps,
  readGooseVersions,
  readPrismaMigrations,
} from "../seed-sources.ts";
import type { MigrationStep } from "../step/migration-step.ts";
import { isRerunnablePrismaMigration } from "../stepping/rerunnable-migrations.ts";
import { highestRecordedFloor, inferInstalledRelease } from "./installed-release.ts";
import { UPGRADE_READ_HINT_PATH, type UpgradeReadHintPublish } from "./run-hint.ts";
import { redactSecrets, resolveCommand, UpgradeRunLog } from "./run-log.ts";
import { RunPhases, type UpgradePhaseChange, type UpgradePhaseOutcome } from "./run-phases.ts";
import { DEFAULT_LEASE_TIMING, holdUpgradeLease, type UpgradeLeaseTiming } from "./runner-lease.ts";
import { type RegisteredStep, UpgradeRunnerRepository } from "./runner-ledger.repository.ts";
import type {
  SchemaTargetReport,
  UpgradeReconciler,
  UpgradeRunnerLog,
  UpgradeSchemaApplier,
} from "./schema-applier.ts";
import { type UpgradeOutcome, upgradeOutcome, UpgradeRunFailure } from "./upgrade-outcome.ts";

/** Defaults proposed in the handoff (Risks): `lock_timeout` and the transient-failure retry. */
export const DEFAULT_LOCK_TIMEOUT_MS = 10_000;
export const DEFAULT_RETRY = { attempts: 3, backoffMs: 2_000 };

export interface UpgradeRunnerOptions {
  postgres: UpgradePostgres;
  /** The shared ClickHouse, read only to seed an empty ledger from `goose_db_version`. */
  clickhouse?: UpgradeClickHouse;
  /** The image's release (its newest manifest) and every step its tree declares. */
  image: { release: string | null; steps: readonly ManifestStep[] };
  releases: { manifests: readonly ReleaseManifest[]; floor: LtsFloor };
  applier: UpgradeSchemaApplier;
  codeSteps?: readonly MigrationStep[];
  reconcilers?: readonly UpgradeReconciler[];
  identity: { image: string; host: string };
  log: UpgradeRunnerLog;
  lease?: Partial<UpgradeLeaseTiming>;
  lockTimeoutMs?: number;
  retry?: { attempts: number; backoffMs: number };
  /** Publishes the read hint for each phase change and the finish (round 8, U2-LIVE). */
  hints?: UpgradeReadHintPublish;
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

/** Why the runner did not resolve a failed migration itself; null when it was never asked to. */
type NotResolvedReason = "below-marker" | "not-shipped" | "no-resolver" | { resolveError: string };

const NOT_RESOLVED: Record<Exclude<NotResolvedReason, object>, string> = {
  "below-marker":
    "It is not newer than the re-runnable marker, so the upgrade does not re-run it. ",
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
  const command = resolveCommand(names[0]!);
  const why =
    typeof reason === "object"
      ? `Marking it rolled back failed: ${redactSecrets(reason.resolveError)}. `
      : NOT_RESOLVED[reason];
  return new UpgradeRunFailure(
    "failed_prisma_migration",
    `Prisma migration ${names.join(", ")} failed and is recorded as failed in _prisma_migrations. ` +
      why +
      `Check what it left behind, then run "${command}" if nothing of it remains, or ` +
      `"prisma migrate resolve --applied ${names[0]}" if you completed it by hand; then upgrade again.`,
    { migrations: names, command },
  );
}

/** A re-runnable migration that failed on every attempt; the next upgrade resolves it itself. */
function rerunnableFailure({
  names,
  attempts,
  error,
}: {
  names: readonly string[];
  attempts: number;
  error: string | null;
}): UpgradeRunFailure {
  const detail = redactSecrets(error ?? "no error given");
  return new UpgradeRunFailure(
    "rerunnable_migration_failed",
    `Prisma migration ${names.join(", ")} failed on all ${attempts} attempts: ${detail}. It is ` +
      `re-runnable, so the next upgrade marks it rolled back and applies it again; no ` +
      `prisma migrate resolve is needed. Fix the cause first.`,
    { migrations: names, attempts, error: detail },
  );
}

/**
 * `pnpm task upgrade` (rethink 6.4, 6.7, 6.11; blitz 3.2, D4): under the runner lease, seeds an
 * empty ledger, plans, refuses below the floor, applies release by release, records each target,
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
  private resolved: { migration: string; attempt: number }[] = [];

  private constructor(private readonly options: UpgradeRunnerOptions) {
    this.ledger = UpgradeLedgerRepository.create({ postgres: options.postgres });
    this.runner = UpgradeRunnerRepository.create({ postgres: options.postgres });
    this.timing = { ...DEFAULT_LEASE_TIMING, ...options.lease };
    this.codeSteps = new Map((options.codeSteps ?? []).map((step) => [step.id, step]));
    this.shipped = shippedSteps({ image: options.image, manifests: options.releases.manifests });
    this.narrate = new UpgradeRunLog(options.log);
    this.shippedIds = new Set(this.shipped.map((step) => step.id));
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

  /** What `upgrade plan` prints: read-only, no lease, nothing written. */
  async plan(): Promise<{ installed: string | null; plan: UpgradePlan }> {
    return this.planFrom(await this.readLedger());
  }

  /** What `upgrade status` prints, read by the reader. */
  async status(): Promise<UpgradeStatus> {
    return createUpgradeReader({
      postgres: this.options.postgres,
      image: { release: this.options.image.release ?? "unreleased", steps: this.shipped },
      floor: this.options.releases.floor,
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

  /** The ledger as the planner reads it; an empty or absent one is read from the tools' records. */
  private async readLedger(): Promise<{ steps: LedgerFacts; runs: UpgradeRun[] }> {
    if ((await this.runner.ledgerExists()) && !(await this.runner.isEmpty())) {
      return { steps: await this.ledger.findSteps(), runs: await this.ledger.findRuns() };
    }
    const { postgres, clickhouse } = this.options;
    const prisma = prismaSteps({ rows: await readPrismaMigrations({ postgres }) });
    const goose = clickhouse ? gooseSteps({ rows: await readGooseVersions({ clickhouse }) }) : [];
    return { steps: [...prisma, ...goose], runs: [] };
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
    const upgraded = runs.some((run) => run.kind === "upgrade");
    const known =
      fresh && !upgraded
        ? ({ known: true, installed: null } as const)
        : inferInstalledRelease({ runs, steps, manifests: releases.manifests });
    if (!known.known) {
      const predates = known.predates ?? "every shipped release";
      const message = `this installation predates ${predates}; upgrade to ${releases.floor.release} (LTS) first, then to this image`;
      const plan: UpgradePlan = {
        outcome: "refused",
        code: "below_lts_floor",
        stopAt: releases.floor.release,
        message,
      };
      return { installed: null, plan };
    }
    const plan = planUpgrade({
      installed: known.installed,
      image,
      floor: releases.floor,
      manifests: releases.manifests,
      ledger: { floor: highestRecordedFloor({ runs }), steps },
    });
    return { installed: known.installed, plan };
  }

  private async upgradeUnderLease({
    signal,
    fresh,
  }: {
    signal: AbortSignal;
    fresh: boolean;
  }): Promise<UpgradeOutcome> {
    if (await this.runner.isEmpty()) {
      const { postgres, clickhouse } = this.options;
      await UpgradeLedgerSeedService.create({ postgres, clickhouse }).seed();
    }
    const before = { steps: await this.ledger.findSteps(), runs: await this.ledger.findRuns() };
    const { installed, plan } = this.planFrom({ ...before, fresh });
    if (plan.outcome === "refused") return this.refuse({ plan });

    const floor = this.options.releases.floor.release;
    const run = await this.ledger.startRun({ kind: "upgrade", floor });
    await this.runner.recordRunPlan({ runId: run.id, release: this.options.image.release, plan });
    this.narrate.planned({ runId: run.id, installed, plan });
    const phases = this.phasesOf({ runId: run.id });
    try {
      const report = await this.applyPlan({ plan, before, runId: run.id, signal, phases });
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
    await this.ledger.finishRun({ runId, outcome, report: { ...report, phases: phases.list() } });
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

  private async refuse({ plan }: { plan: Extract<UpgradePlan, { outcome: "refused" }> }) {
    const run = await this.ledger.startRun({ kind: "upgrade" });
    await this.runner.recordRunPlan({ runId: run.id, release: this.options.image.release, plan });
    const phases = this.phasesOf({ runId: run.id });
    await phases.start({ name: "preflight" });
    await phases.finish({ outcome: "failed" });
    await this.finishRun({
      runId: run.id,
      outcome: "failed",
      report: { refused: plan.code },
      phases,
    });
    const code =
      plan.code === "below_lts_floor" ? "refused_below_floor" : "refused_image_below_floor";
    return upgradeOutcome({
      code,
      message: plan.message,
      runId: run.id,
      detail: { stopAt: plan.stopAt },
    });
  }

  private async applyPlan({
    plan,
    before,
    runId,
    signal,
    phases,
  }: {
    plan: Extract<UpgradePlan, { outcome: "planned" }>;
    before: { steps: UpgradeStep[]; runs: UpgradeRun[] };
    runId: string;
    signal: AbortSignal;
    phases: RunPhases;
  }): Promise<Record<string, unknown>> {
    await phases.start({ name: "preflight" });
    this.resolved = [];
    await this.resolveLeftFailures({ signal });
    await this.runner.registerSteps({ steps: this.shipped });
    const reopened = await this.reopenAfterRollback({ ...before });
    await this.runner.setStatus({ ids: plan.notNeeded, status: "not-needed", runId });
    await phases.end({ name: "preflight", outcome: "succeeded" });
    const recorded = new Map(before.steps.map((step) => [step.id, step]));
    const applied: string[] = [];
    for (const release of plan.releases) {
      signal.throwIfAborted();
      if (release.schema.length > 0) {
        await this.applySchema({ release, signal, runId, phases });
        applied.push(...release.schema);
      }
      for (const id of release.blocking) {
        await this.runBlockingStep({ id, recorded: recorded.get(id), signal, runId });
        applied.push(id);
      }
    }
    await phases.start({ name: "reconcile" });
    await this.runReconcilers({ signal });
    await phases.end({ name: "reconcile", outcome: "succeeded" });
    return { applied, notNeeded: plan.notNeeded, reopened, resolved: this.resolved };
  }

  /** Round 21, S3-RETRY: the failed rows the runner may resolve, or why it may not. */
  private resolvable({ names }: { names: readonly string[] }): NotResolvedReason | null {
    if (!names.every((name) => isRerunnablePrismaMigration({ name }))) return "below-marker";
    if (!names.every((name) => this.shippedIds.has(`prisma:${name}`))) return "not-shipped";
    if (!this.options.applier.resolveRolledBack) return "no-resolver";
    return null;
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

  /** A failed row an earlier run left: resolved when re-runnable, else the run stops naming it. */
  private async resolveLeftFailures({ signal }: { signal: AbortSignal }): Promise<void> {
    const failed = await this.failedPrismaMigrations();
    if (failed.length === 0) return;
    const elapsed = await this.resolveRolledBack({ names: failed, signal });
    for (const [migration, resolveMs] of elapsed) {
      this.resolved.push({ migration, attempt: 0 });
      this.narrate.resolvedBeforeApply({ migration, resolveMs });
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
    await this.recordPrisma({ open: engines[0].open, runId });
    await this.recordClickHouse({ open: engines[1].open, reports, runId });
    const failedPrisma = await this.failedPrismaMigrations();
    const failedOn = (engine: SchemaTargetReport["engine"]) =>
      reports.some((report) => report.engine === engine && !report.ok);
    const postgresFailed = failedPrisma.length > 0 || failedOn("postgres");
    const outcome = (failed: boolean) => (failed ? "failed" : "succeeded");
    await phases.end({ name: "postgres-schema", outcome: outcome(postgresFailed) });
    await phases.end({ name: "clickhouse-schema", outcome: outcome(failedOn("clickhouse")) });
    if (failedPrisma.length > 0) {
      const reason = this.resolvable({ names: failedPrisma });
      if (reason !== null) throw prismaFailure({ names: failedPrisma, reason });
      const error = reports.find((report) => report.engine === "postgres" && !report.ok)?.error;
      throw rerunnableFailure({ names: failedPrisma, attempts, error: error ?? null });
    }
    const failing = reports.filter((report) => !report.ok);
    if (failing.length === 0) return;
    const named = failing.map(
      (report) => `${report.target} (${redactSecrets(report.error ?? "no error given")})`,
    );
    throw new UpgradeRunFailure("schema_failed", `schema failed on ${named.join(", ")}`, {
      targets: failing.map(({ target, error }) => ({
        target,
        error: error === null ? null : redactSecrets(error),
      })),
    });
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
      const reports = await applier.apply({ release: release.release, lockTimeoutMs, signal });
      if (reports.every((report) => report.ok)) {
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
      this.narrate.resolvedForRetry({ migration, ...retrying, resolveMs, error: error ?? null });
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
  }

  /** D4: one target row per step and endpoint; the step is the aggregate, failed if any is. */
  private async recordClickHouse({
    open,
    reports,
    runId,
  }: {
    open: readonly string[];
    reports: readonly SchemaTargetReport[];
    runId: string;
  }): Promise<void> {
    const targets = reports.flatMap((report) => (report.engine === "clickhouse" ? [report] : []));
    if (targets.length === 0 || open.length === 0) return;
    const statuses = new Map<string, TargetStatus[]>();
    for (const target of targets) {
      let blamed = false;
      for (const id of open.toSorted()) {
        const status = targetStatus({ target, id, blamed });
        blamed ||= status === "failed";
        const lastError = status === "failed" ? target.error : null;
        const version = id.slice("clickhouse:".length);
        const stepId = id;
        await this.ledger.upsertTarget({
          stepId,
          target: target.target,
          status,
          version,
          lastError,
        });
        statuses.set(id, [...(statuses.get(id) ?? []), status]);
      }
    }
    const failedOn = targets.filter((target) => !target.ok).map((target) => target.target);
    for (const [id, perTarget] of statuses) {
      if (perTarget.includes("failed")) {
        const lastError = `failed on ${failedOn.join(", ")}`;
        await this.runner.setStatus({ ids: [id], status: "failed", runId, lastError });
      } else if (perTarget.every((status) => status === "done")) {
        await this.runner.setStatus({ ids: [id], status: "done", runId });
      }
    }
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
    if (this.shipped.find((step) => step.id === id)?.kind === "event-upcast") return;
    const step = this.codeSteps.get(id);
    if (!step) {
      const lastError = `blocking step ${id} is in the plan but this image declares no such step`;
      await this.runner.setStatus({ ids: [id], status: "failed", runId, lastError });
      throw new UpgradeRunFailure("step_failed", lastError, { step: id });
    }
    await this.runner.markRunning({ id, runId });
    const resuming = (recorded?.report ?? null) !== null;
    this.narrate.stepStarted({ id, description: step.description, resuming });
    try {
      const report = await step.run({
        checkpoint: {
          resumeFrom: recorded?.report ?? null,
          save: ({ report: saved }) => this.runner.saveReport({ id, report: saved }),
        },
        dryRun: false,
        signal,
      });
      await this.runner.setStatus({ ids: [id], status: "done", runId, report });
      this.narrate.stepEnded({ id, error: null });
    } catch (error) {
      const lastError = describeError(error);
      this.narrate.stepEnded({ id, error: lastError });
      await this.runner.setStatus({ ids: [id], status: "failed", runId, lastError });
      throw new UpgradeRunFailure("step_failed", `blocking step ${id} failed: ${lastError}`, {
        step: id,
      });
    }
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

  private async runReconcilers({ signal }: { signal: AbortSignal }): Promise<void> {
    const failed: string[] = [];
    for (const reconciler of this.options.reconcilers ?? []) {
      signal.throwIfAborted();
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
