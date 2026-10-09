import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

import { storesOwner } from "@langwatch/process-stores/config";
import type { ScopedSecrets } from "@langwatch/secrets";
import pg from "pg";

import { BackgroundStepsService, startBackgroundSteps } from "../background/index.ts";
import { UpgradeLedgerRepository } from "../ledger.repository.ts";
import type { UpgradeLease } from "../ledger.ts";
import { loadReleases } from "../manifest/manifest-loader.ts";
import type { ReleaseTreeSteps } from "../manifest/stamp.ts";
import type { UpgradePostgres } from "../ports.ts";
import { UPGRADE_LEASE_NAME } from "../runner/runner-lease.ts";
import { UpgradeRunnerRepository } from "../runner/runner-ledger.repository.ts";
import { EXIT_CODES } from "../runner/upgrade-outcome.ts";
import { PreRosterRepository } from "../serving-roster/pre-roster.repository.ts";
import {
  createServingRoster,
  type ServingRoster,
} from "../serving-roster/serving-roster.service.ts";
import { isDeclaredMigrationStep, isMigrationStep } from "../step/migration-step.ts";
import { type FirstInstallUpgrade, spawnFirstInstallUpgrade } from "./first-install-upgrade.ts";
import { IMAGE_CODE_STEPS_FILE, readImageCodeSteps } from "./image-code-steps.ts";
import { imageGateSteps, readImageTree } from "./image-tree.ts";
import {
  type ServingRole,
  type ServingVerdict,
  UPGRADE_COMMAND,
  type UpgradeFailedRun,
  UPGRADE_RE_ASK_MS,
} from "./serving-gate.ts";
import { SERVING_ROSTER_TIMING } from "./serving-roster-timing.ts";
import { createUpgradeGate, type UpgradeGate } from "./upgrade-gate.service.ts";

/** Roster entries dead this long are deleted when a process records its own (plan F-10). */
export const SERVING_ROSTER_PRUNE_AFTER_MS = 7 * 24 * 60 * 60_000;

/** Writers before the roster count as present this long after the upgrade run (Round 47 E2). */
export const SERVING_ROSTER_PRE_ROSTER_GRACE_MS = 30 * 60_000;

/** A process with no database (the memory tier) has no installation to be behind. */
const NO_LEDGER_GATE: UpgradeGate = {
  admit: async () => ({ admitted: true, outcome: "current" }),
  release: async () => undefined,
  serving: () => true,
};

/** ClickHouse is mandatory (rounds 20 and 22): a database with no ClickHouse refuses by name. */
export const NO_CLICKHOUSE_REFUSAL =
  "ClickHouse is required and no ClickHouse target is configured. Set CLICKHOUSE_URL (or a " +
  "private ClickHouse route), run `pnpm task upgrade`, then start this process again.";

const NO_CLICKHOUSE_GATE: UpgradeGate = {
  admit: async () => ({
    admitted: false,
    outcome: "no-clickhouse",
    refusal: NO_CLICKHOUSE_REFUSAL,
  }),
  release: async () => undefined,
  serving: () => false,
};

/** Where the gate reports what it cannot refuse on: a lapse, a recovery, a rollback, a failure. */
export type ServingGateWarn = (message: string, fields?: Record<string, unknown>) => void;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const emitWarning: ServingGateWarn = (message, fields) =>
  process.emitWarning(fields ? `${message} ${JSON.stringify(fields)}` : message, "UpgradeGate");

/**
 * The gate over an open ledger connection: an absent ledger reads as empty, the worker runs
 * `upgrade` until current (UPGRADE-IN-WORKER), and the connection closes on refusal or release.
 */
export function upgradeGateOver({
  role,
  postgres,
  close,
  tree,
  release,
  withClickHouse,
  processId,
  firstInstall,
  warn = emitWarning,
  wait = (ms) => sleep(ms),
}: {
  role: ServingRole;
  postgres: UpgradePostgres;
  close: () => Promise<void>;
  tree: ReleaseTreeSteps;
  release: string | null;
  withClickHouse: boolean;
  processId: string;
  firstInstall: FirstInstallUpgrade;
  warn?: ServingGateWarn;
  /** The worker's pause between asks; tests pass their own. */
  wait?: (ms: number) => Promise<unknown>;
}): UpgradeGate {
  const ledger = UpgradeLedgerRepository.create({ postgres });
  const runner = UpgradeRunnerRepository.create({ postgres });
  const preRoster = PreRosterRepository.create({ postgres });
  const { blockingSteps, declaredSteps } = imageGateSteps({ tree, withClickHouse });
  const roster = createServingRoster({
    ledger: {
      writeRosterEntry: (input) => ledger.writeRosterEntry(input),
      findLiveRoster: (input) => ledger.findLiveRoster(input),
      removeRosterEntry: (input) => ledger.removeRosterEntry(input),
      pruneRoster: (input) => runner.pruneServingRoster(input),
      findPreRosterHistory: () => preRoster.findPreRosterHistory(),
    },
    ...SERVING_ROSTER_TIMING,
    pruneDeadAfterMs: SERVING_ROSTER_PRUNE_AFTER_MS,
    preRosterGraceMs: SERVING_ROSTER_PRE_ROSTER_GRACE_MS,
    onRefreshError: (error) =>
      warn("roster refresh failed", { processId, error: messageOf(error) }),
    onPruneError: (error) => warn("roster prune failed", { processId, error: messageOf(error) }),
  });
  const gate = createUpgradeGate({
    role,
    processId,
    image: { release, blockingSteps, name: release ?? "unreleased", declaredSteps },
    ledger: {
      findSteps: async () => ((await runner.ledgerExists()) ? ledger.findSteps() : []),
      findRuns: async () => ((await runner.ledgerExists()) ? ledger.findRuns() : []),
    },
    roster,
    schemaIsEmpty: async () => !(await runner.prismaHistoryExists()),
    rollback: {
      reopen: (input) => runner.reopenDoneSteps(input),
      onReopened: ({ ids, reason }) => warn(`${reason}; reopened ${ids.join(", ")}`, { processId }),
      onError: (error) => warn("rollback detection failed", { processId, error: messageOf(error) }),
    },
  });
  const findFailedSteps = async (): Promise<UpgradeFailedRun["failedSteps"]> => {
    const steps = (await runner.ledgerExists()) ? await ledger.findSteps() : [];
    return steps
      .filter((step) => step.status === "failed")
      .map(({ id, lastError }) => ({ id, error: lastError }));
  };
  const findLeaseHolder = () => liveLeaseHolder({ runner });
  let closed: Promise<void> | null = null;
  const closeOnce = () => (closed ??= close());
  return {
    async admit(): Promise<ServingVerdict> {
      try {
        const verdict =
          role === "worker"
            ? await admitAfterFirstInstall({
                gate,
                firstInstall,
                warn,
                findFailedSteps,
                findLeaseHolder,
                wait,
              })
            : await gate.admit();
        if (closesOn(verdict)) await closeOnce();
        return verdict;
      } catch (error) {
        await closeOnce();
        throw error;
      }
    },
    async release() {
      try {
        await gate.release();
      } finally {
        await closeOnce();
      }
    },
    serving: () => gate.serving(),
    ...(role === "worker"
      ? {
          backgroundSteps: backgroundStepsOver({
            postgres,
            roster,
            gate,
            processId,
            release,
            warn,
          }),
        }
      : {}),
  };
}

/** Who holds the upgrade lease now, or null when it is free (a lapsed lease is free). */
export type UpgradeLeaseHolder = () => Promise<Pick<
  UpgradeLease,
  "owner" | "host" | "image"
> | null>;

/** A holding or upgrading api keeps the connection: it asks again over it. */
const closesOn = (verdict: ServingVerdict) =>
  !verdict.admitted && verdict.outcome !== "holding" && verdict.outcome !== "upgrading";

async function liveLeaseHolder({ runner }: { runner: UpgradeRunnerRepository }) {
  if (!(await runner.ledgerExists())) return null;
  return runner.findLiveLease({ name: UPGRADE_LEASE_NAME });
}

/** Why the worker runs nothing yet: a live lease holder, or a failed step awaiting a Retry. */
async function waitReason({
  findLeaseHolder,
  findFailedSteps,
  mayRunPastFailure,
}: {
  findLeaseHolder: UpgradeLeaseHolder;
  findFailedSteps: () => Promise<UpgradeFailedRun["failedSteps"]>;
  mayRunPastFailure: boolean;
}): Promise<Readonly<{ line: string; waitingOn: string }> | null> {
  const holder = await findLeaseHolder();
  if (holder) {
    const line = `the upgrade lease is held by ${holder.owner} on ${holder.host} (${holder.image}); this worker waits for its run`;
    return { line, waitingOn: "the upgrade lease" };
  }
  if (mayRunPastFailure) return null;
  const failed = await findFailedSteps().catch(() => []);
  if (failed.length === 0) return null;
  const ids = failed.map(({ id }) => id).join(", ");
  return {
    line: `the upgrade failed on ${ids}; this worker waits for a Retry`,
    waitingOn: "a Retry",
  };
}

function sayRun({ verdict, warn }: { verdict: ServingVerdict; warn: ServingGateWarn }): void {
  const why =
    verdict.outcome === "first-install"
      ? "first install: the ledger and the schema are empty"
      : `behind this image: blocking steps not done: ${"outstanding" in verdict ? verdict.outstanding.join(", ") : ""}`;
  warn(
    `${why}, so this worker runs \`${UPGRADE_COMMAND}\` before it takes jobs; its lines follow`,
    {
      phase: verdict.outcome,
      waitingOn: `\`${UPGRADE_COMMAND}\``,
      next: "nothing to do: the worker takes jobs when the upgrade finishes",
    },
  );
}

/**
 * The worker runs `upgrade` while its installation is behind (UPGRADE-IN-WORKER): it waits while
 * another runner holds the lease and, after a failed run, for a Retry that returns the step to
 * `pending`; a restart is an operator act, so a new worker runs once more (UIW-3).
 */
export async function admitAfterFirstInstall({
  gate,
  firstInstall,
  warn,
  findFailedSteps = async () => [],
  findLeaseHolder = async () => null,
  wait = (ms) => sleep(ms),
  reAskMs = UPGRADE_RE_ASK_MS,
}: {
  gate: Pick<UpgradeGate, "admit">;
  firstInstall: FirstInstallUpgrade;
  warn: ServingGateWarn;
  findFailedSteps?: () => Promise<UpgradeFailedRun["failedSteps"]>;
  findLeaseHolder?: UpgradeLeaseHolder;
  wait?: (ms: number) => Promise<unknown>;
  reAskMs?: number;
}): Promise<ServingVerdict> {
  let mayRunPastFailure = true;
  let ranClean = false;
  let lastWait = "";
  for (;;) {
    const verdict = await gate.admit();
    if (verdict.outcome !== "first-install" && verdict.outcome !== "behind") return verdict;
    const reason = await waitReason({ findLeaseHolder, findFailedSteps, mayRunPastFailure });
    if (reason) {
      const next = "nothing to do: this worker asks again every 10 s";
      if (reason.line !== lastWait)
        warn(reason.line, { phase: "upgrade-wait", waitingOn: reason.waitingOn, next });
      lastWait = reason.line;
      await wait(reAskMs);
      continue;
    }
    lastWait = "";
    // An exit 0 that left the ledger behind runs again only after the re-ask interval.
    if (ranClean) await wait(reAskMs);
    sayRun({ verdict, warn });
    const { exitCode } = await firstInstall();
    ranClean = exitCode === 0;
    if (ranClean) continue;
    // After any run a failed step waits for a Retry; a lease loser's exit is not a failure.
    mayRunPastFailure = false;
    if (exitCode !== EXIT_CODES.lease_not_acquired) warnFailedRun({ verdict, exitCode, warn });
    await wait(reAskMs);
  }
}

function warnFailedRun({
  verdict,
  exitCode,
  warn,
}: {
  verdict: ServingVerdict;
  exitCode: number;
  warn: ServingGateWarn;
}): void {
  warn(`\`${UPGRADE_COMMAND}\` exited ${exitCode}; this worker waits for a Retry`, {
    phase: verdict.outcome,
    waitingOn: "a Retry",
    next: "retry the failed step from Ops > Upgrades or the upgrade console",
  });
}

/** The worker's background steps over the gate's own connection (round 14: framework runs). */
function backgroundStepsOver({
  postgres,
  roster,
  gate,
  processId,
  release,
  warn,
}: {
  postgres: UpgradePostgres;
  roster: Pick<ServingRoster, "oldWritersGoneFor">;
  gate: Pick<UpgradeGate, "serving">;
  processId: string;
  release: string | null;
  warn: ServingGateWarn;
}) {
  const ledger = UpgradeLedgerRepository.create({ postgres });
  const runner = UpgradeRunnerRepository.create({ postgres });
  const log = (level: "info" | "warn", message: string, fields: object) =>
    level === "warn" ? warn(message, { processId, ...fields }) : undefined;
  return {
    isStep: isDeclaredMigrationStep,
    start: (steps: readonly unknown[]) => {
      const service = BackgroundStepsService.create({
        ledger: {
          findSteps: () => ledger.findSteps(),
          acquireLease: (input) => ledger.acquireLease(input),
          renewLease: (input) => ledger.renewLease(input),
          releaseLease: (input) => ledger.releaseLease(input),
          markRunning: (input) => runner.markRunning(input),
          setStatus: (input) => runner.setStatus(input),
          saveReport: (input) => runner.saveReport(input),
        },
        steps: steps.filter(isMigrationStep),
        serving: () => gate.serving(),
        oldWritersGoneFor: (input) => roster.oldWritersGoneFor(input),
        identity: { owner: processId, image: release ?? "unreleased", host: hostname() },
        log,
      });
      return startBackgroundSteps({ service, log });
    },
  };
}

/** The gate's one connection, in the schema `?schema=` names, where the runner wrote the ledger. */
export function gatePoolConfig({ databaseUrl }: { databaseUrl: string }): pg.PoolConfig {
  const schema = URL.canParse(databaseUrl) ? new URL(databaseUrl).searchParams.get("schema") : null;
  return {
    connectionString: databaseUrl,
    max: 1,
    allowExitOnIdle: true,
    ...(schema ? { options: `-c search_path="${schema}"` } : {}),
  };
}

/** The tree both serving roles gate on: the schema it ships and the tasks process's code steps. */
export function servingImageTree({
  codeStepsFile = IMAGE_CODE_STEPS_FILE,
}: { codeStepsFile?: string } = {}): ReleaseTreeSteps {
  return readImageTree({ codeSteps: readImageCodeSteps({ file: codeStepsFile }) });
}

/**
 * `withUpgradeGate`'s factory for the api and worker (held question "mig-serving-gate data
 * source", default (a)): one connection of its own from the stores' `DATABASE_URL`, opened only
 * when the gate first asks. Specs: specs/upgrade/serving-gate.feature and entry-points.feature.
 */
export async function servingUpgradeGate({
  secrets,
  role,
  warn,
}: {
  secrets: ScopedSecrets;
  role: ServingRole;
  warn?: ServingGateWarn;
}): Promise<UpgradeGate> {
  const tree = servingImageTree();
  const release = loadReleases().manifests.at(-1)?.release ?? null;
  return secrets.into(storesOwner.secrets.database, (database) =>
    secrets.into(storesOwner.secrets.clickhouse, (clickhouse) =>
      secrets.into(storesOwner.secrets.clickhouseRoutes, (routes) => {
        if (!database?.trim()) return NO_LEDGER_GATE;
        if (!clickhouse?.trim() && routes.size === 0) return NO_CLICKHOUSE_GATE;
        const pool = new pg.Pool(gatePoolConfig({ databaseUrl: database }));
        return upgradeGateOver({
          role,
          postgres: pool,
          close: () => pool.end(),
          tree,
          release,
          withClickHouse: true,
          processId: `${hostname()}:${process.pid}:${role}`,
          firstInstall: spawnFirstInstallUpgrade(),
          warn,
        });
      }),
    ),
  );
}
