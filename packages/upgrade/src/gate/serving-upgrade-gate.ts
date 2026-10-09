import { hostname } from "node:os";

import { storesOwner } from "@langwatch/process-stores/config";
import type { ScopedSecrets } from "@langwatch/secrets";
import pg from "pg";

import { BackgroundStepsService, startBackgroundSteps } from "../background/index.ts";
import { UpgradeLedgerRepository } from "../ledger.repository.ts";
import { loadReleases } from "../manifest/manifest-loader.ts";
import type { ReleaseTreeSteps } from "../manifest/stamp.ts";
import type { UpgradePostgres } from "../ports.ts";
import { UpgradeRunnerRepository } from "../runner/runner-ledger.repository.ts";
import { PreRosterRepository } from "../serving-roster/pre-roster.repository.ts";
import {
  createServingRoster,
  type ServingRoster,
} from "../serving-roster/serving-roster.service.ts";
import { isMigrationStep } from "../step/migration-step.ts";
import { type FirstInstallUpgrade, spawnFirstInstallUpgrade } from "./first-install-upgrade.ts";
import { IMAGE_CODE_STEPS_FILE, readImageCodeSteps } from "./image-code-steps.ts";
import { imageGateSteps, readImageTree } from "./image-tree.ts";
import { type ServingRole, type ServingVerdict, UPGRADE_COMMAND } from "./serving-gate.ts";
import { createUpgradeGate, type UpgradeGate } from "./upgrade-gate.service.ts";

/** Roster refresh and stale bound (held question "cloud presence timings", default taken). */
export const SERVING_ROSTER_TIMING = { staleAfterMs: 60_000, refreshEveryMs: 15_000 } as const;

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
 * The gate over an open ledger connection: an absent ledger reads as empty, the api's first
 * install runs `upgrade` once and asks again (Q10), and the connection closes on refusal or
 * release.
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
    onLapseChange: (lapsed) =>
      warn(
        lapsed
          ? `roster entry lapsed past ${SERVING_ROSTER_TIMING.staleAfterMs} ms: ${processId} stops serving; ` +
              "readiness answers 503 until a roster write succeeds (check DATABASE_URL reaches Postgres)"
          : `roster entry written again: ${processId} serves again`,
        { processId },
      ),
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
  let closed: Promise<void> | null = null;
  const closeOnce = () => (closed ??= close());
  return {
    async admit(): Promise<ServingVerdict> {
      try {
        const verdict = await admitAfterFirstInstall({ gate, firstInstall, warn });
        if (!verdict.admitted) await closeOnce();
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

/** The api's first install runs `upgrade` once and asks again (Q10), saying so first. */
export async function admitAfterFirstInstall({
  gate,
  firstInstall,
  warn,
}: {
  gate: Pick<UpgradeGate, "admit">;
  firstInstall: FirstInstallUpgrade;
  warn: ServingGateWarn;
}): Promise<ServingVerdict> {
  const verdict = await gate.admit();
  if (verdict.outcome !== "first-install") return verdict;
  warn(
    `first install: the ledger and the schema are empty, so this api runs \`${UPGRADE_COMMAND}\` ` +
      "once before it serves; its lines follow",
    {
      phase: "first-install",
      waitingOn: `\`${UPGRADE_COMMAND}\``,
      next: "nothing to do: the api serves when the upgrade finishes",
    },
  );
  const exitCode = await firstInstall();
  if (exitCode === 0) return gate.admit();
  return { ...verdict, refusal: `${verdict.refusal} The api ran it; it exited ${exitCode}.` };
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
    isStep: isMigrationStep,
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
