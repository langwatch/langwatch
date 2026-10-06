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
import { highestRecordedFloor, inferInstalledRelease } from "./installed-release.ts";
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
}

type LedgerFacts = readonly Pick<UpgradeStep, "id" | "status">[];
type TargetStatus = Extract<UpgradeStepStatus, "done" | "failed" | "pending">;

const isPrisma = (id: string) => id.startsWith("prisma:");
const isGoose = (id: string) => id.startsWith("clickhouse:");
const describeError = (error: unknown) => (error instanceof Error ? error.message : String(error));

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

function prismaFailure({ names }: { names: readonly string[] }): UpgradeRunFailure {
  const command = `prisma migrate resolve --rolled-back ${names[0]}`;
  return new UpgradeRunFailure(
    "failed_prisma_migration",
    `Prisma migration ${names.join(", ")} failed and is recorded as failed in _prisma_migrations. ` +
      `Check what it left behind, then run "${command}" if nothing of it remains, or ` +
      `"prisma migrate resolve --applied ${names[0]}" if you completed it by hand; then upgrade again.`,
    { migrations: names, command },
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

  private constructor(private readonly options: UpgradeRunnerOptions) {
    this.ledger = UpgradeLedgerRepository.create({ postgres: options.postgres });
    this.runner = UpgradeRunnerRepository.create({ postgres: options.postgres });
    this.timing = { ...DEFAULT_LEASE_TIMING, ...options.lease };
    this.codeSteps = new Map((options.codeSteps ?? []).map((step) => [step.id, step]));
    this.shipped = shippedSteps({ image: options.image, manifests: options.releases.manifests });
  }

  static create(options: UpgradeRunnerOptions): UpgradeRunnerService {
    return new UpgradeRunnerService(options);
  }

  async run({ signal }: { signal: AbortSignal }): Promise<UpgradeOutcome> {
    const fresh = !(await this.runner.prismaHistoryExists());
    const bootstrapFailed = await this.bootstrapFreshDatabase({ signal });
    if (bootstrapFailed) return bootstrapFailed;
    await this.ledger.createTables();
    const { identity } = this.options;
    const owner = `${identity.host}:${generate("upgradelease").toString()}`;
    const held = await holdUpgradeLease({
      ledger: this.ledger,
      runner: this.runner,
      identity: { ...identity, owner },
      timing: this.timing,
      log: this.options.log,
      signal,
      work: (args) => this.upgradeUnderLease({ ...args, fresh }),
    });
    if (!held.acquired) return this.leaseRefused({ holder: held.holder });
    if (!held.lost) return held.result;
    const { message, runId, detail } = held.result;
    return upgradeOutcome({ code: "lease_lost", message: `lease lost: ${message}`, runId, detail });
  }

  /** A database with no Prisma history gets its Postgres schema before the ledger tables exist. */
  private async bootstrapFreshDatabase({ signal }: { signal: AbortSignal }) {
    const { applier } = this.options;
    if (!applier.bootstrapPostgres || (await this.runner.prismaHistoryExists())) return null;
    this.options.log.info("no Prisma history: applying the Postgres schema before the ledger");
    const lockTimeoutMs = this.options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    const report = await applier.bootstrapPostgres({ lockTimeoutMs, signal });
    if (report.ok) return null;
    return upgradeOutcome({
      code: "schema_failed",
      message: `the Postgres schema failed before the ledger existed: ${report.error ?? "no error given"}`,
      detail: { targets: [{ target: report.target, error: report.error }] },
    });
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
    this.options.log.info("upgrade planned", { runId: run.id, installed, fresh: plan.fresh });
    try {
      const report = await this.applyPlan({ plan, before, runId: run.id, signal });
      await this.ledger.finishRun({ runId: run.id, outcome: "succeeded", report });
      const message = `upgraded to ${this.options.image.release ?? "this image"}`;
      return upgradeOutcome({ code: "done", message, runId: run.id, detail: report });
    } catch (error) {
      const failure =
        error instanceof UpgradeRunFailure
          ? error
          : new UpgradeRunFailure(signal.aborted ? "lease_lost" : "failed", describeError(error));
      const { code, message, detail } = failure;
      await this.ledger.finishRun({
        runId: run.id,
        outcome: "failed",
        report: { code, error: message, ...detail },
      });
      return upgradeOutcome({ code, message, runId: run.id, detail });
    }
  }

  private async refuse({ plan }: { plan: Extract<UpgradePlan, { outcome: "refused" }> }) {
    const run = await this.ledger.startRun({ kind: "upgrade" });
    await this.runner.recordRunPlan({ runId: run.id, release: this.options.image.release, plan });
    await this.ledger.finishRun({
      runId: run.id,
      outcome: "failed",
      report: { refused: plan.code },
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
  }: {
    plan: Extract<UpgradePlan, { outcome: "planned" }>;
    before: { steps: UpgradeStep[]; runs: UpgradeRun[] };
    runId: string;
    signal: AbortSignal;
  }): Promise<Record<string, unknown>> {
    const failedPrisma = await this.failedPrismaMigrations();
    if (failedPrisma.length > 0) throw prismaFailure({ names: failedPrisma });
    await this.runner.registerSteps({ steps: this.shipped });
    const reopened = await this.reopenAfterRollback({ ...before, runId });
    await this.runner.setStatus({ ids: plan.notNeeded, status: "not-needed", runId });
    const recorded = new Map(before.steps.map((step) => [step.id, step]));
    const applied: string[] = [];
    for (const release of plan.releases) {
      signal.throwIfAborted();
      if (release.schema.length > 0) {
        await this.applySchema({ release, signal, runId });
        applied.push(...release.schema);
      }
      for (const id of release.blocking) {
        await this.runBlockingStep({ id, recorded: recorded.get(id), signal, runId });
        applied.push(id);
      }
    }
    await this.runReconcilers({ signal });
    return { applied, notNeeded: plan.notNeeded, reopened };
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
  }: {
    release: PlannedRelease;
    signal: AbortSignal;
    runId: string;
  }): Promise<void> {
    const reports = await this.applyWithRetry({ release, signal });
    await this.recordPrisma({ open: release.schema.filter(isPrisma), runId });
    await this.recordClickHouse({ open: release.schema.filter(isGoose), reports, runId });
    const failedPrisma = await this.failedPrismaMigrations();
    if (failedPrisma.length > 0) throw prismaFailure({ names: failedPrisma });
    const failing = reports.filter((report) => !report.ok);
    if (failing.length === 0) return;
    const named = failing.map((report) => `${report.target} (${report.error ?? "no error given"})`);
    throw new UpgradeRunFailure("schema_failed", `schema failed on ${named.join(", ")}`, {
      targets: failing.map(({ target, error }) => ({ target, error })),
    });
  }

  /** Retries with backoff only a failure that left no failed Prisma migration (handoff Risks). */
  private async applyWithRetry({
    release,
    signal,
  }: {
    release: PlannedRelease;
    signal: AbortSignal;
  }): Promise<readonly SchemaTargetReport[]> {
    const { applier, log } = this.options;
    const lockTimeoutMs = this.options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    const retry = this.options.retry ?? DEFAULT_RETRY;
    for (let attempt = 1; ; attempt++) {
      const reports = await applier.apply({ release: release.release, lockTimeoutMs, signal });
      if (reports.every((report) => report.ok) || attempt >= retry.attempts) return reports;
      if ((await this.failedPrismaMigrations()).length > 0) return reports;
      const waitMs = retry.backoffMs * 2 ** (attempt - 1);
      log.warn("schema apply failed without a failed migration; retrying", { attempt, waitMs });
      await sleep(waitMs, undefined, { signal });
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
    } catch (error) {
      const lastError = describeError(error);
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
    runId,
  }: {
    runs: UpgradeRun[];
    steps: UpgradeStep[];
    runId: string;
  }): Promise<string[]> {
    const current = this.options.image.release;
    const last = lastRecordedUpgrade({ runs })?.release;
    if (!current || !last || compareReleases({ left: current, right: last }) >= 0) return [];
    const newer = (release: string | null) =>
      release !== null && compareReleases({ left: release, right: current }) > 0;
    const reopened = steps
      .filter((step) => step.mode === "background" && step.status === "done" && newer(step.release))
      .map((step) => step.id);
    await this.runner.setStatus({ ids: reopened, status: "pending", runId });
    return reopened;
  }

  private async runReconcilers({ signal }: { signal: AbortSignal }): Promise<void> {
    const failed: string[] = [];
    for (const reconciler of this.options.reconcilers ?? []) {
      signal.throwIfAborted();
      try {
        await reconciler.run({ signal });
      } catch (error) {
        this.options.log.warn("reconciler failed", {
          reconciler: reconciler.name,
          error: describeError(error),
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
