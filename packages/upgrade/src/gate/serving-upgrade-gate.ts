import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

import { storesOwner } from "@langwatch/process-stores/config";
import type { ScopedSecrets } from "@langwatch/secrets";
import pg from "pg";
import { z } from "zod";

import {
  type BackgroundStepsQueue,
  BackgroundStepsService,
  startBackgroundSteps,
} from "../background/index.ts";
import { UpgradeLedgerRepository } from "../ledger.repository.ts";
import type { UpgradeLease, UpgradeRun } from "../ledger.ts";
import { loadReleases } from "../manifest/manifest-loader.ts";
import type { ReleaseTreeSteps } from "../manifest/stamp.ts";
import type { UpgradePostgres } from "../ports.ts";
import { configuredClickHouseTargets, writeUpgradeLine } from "../runner/image-upgrade.ts";
import { UPGRADE_LEASE_NAME } from "../runner/runner-lease.ts";
import { UpgradeRunnerRepository } from "../runner/runner-ledger.repository.ts";
import { PRIVATE_TARGET_PREFIX } from "../runner/schema-applier.ts";
import { EXIT_CODES, type UpgradeOutcomeCode } from "../runner/upgrade-outcome.ts";
import { prismaSteps, readPrismaMigrations } from "../seed-sources.ts";
import { credentialKeyFingerprint } from "../serving-roster/credential-key-fingerprint.ts";
import { PreRosterRepository } from "../serving-roster/pre-roster.repository.ts";
import {
  createServingRoster,
  type ServingRoster,
} from "../serving-roster/serving-roster.service.ts";
import { isDeclaredMigrationStep, isMigrationStep } from "../step/migration-step.ts";
import { type LedgerTextRedactor, ledgerRedactor } from "../step/step-log.ts";
import type { FirstInstallUpgrade } from "./first-install-upgrade.ts";
import { IMAGE_CODE_STEPS_FILE, readImageCodeSteps } from "./image-code-steps.ts";
import { imageGateSteps, imageRelease, readImageTree } from "./image-tree.ts";
import {
  type BootUpgradeModules,
  inProcessUpgrade,
  redisReadHintPublisher,
} from "./in-process-upgrade.ts";
import {
  type ServingRole,
  type ServingVerdict,
  UPGRADE_COMMAND,
  type UpgradeFailedRun,
  UPGRADE_RE_ASK_MS,
} from "./serving-gate.ts";
import { SERVING_ROSTER_TIMING } from "./serving-roster-timing.ts";
import { privateTargetsBehind, startTargetCatchUp } from "./target-catch-up.ts";
import {
  redisTargetsCatchingUp,
  type TargetsCatchingUpStore,
  watchTargetsCatchingUp,
} from "./targets-catching-up.ts";
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
  credentialKeys,
  clickhouseTargets = [],
  targetsCatchingUp = null,
  warn = emitWarning,
  wait = (ms) => sleep(ms),
  secretValues = [],
}: {
  role: ServingRole;
  postgres: UpgradePostgres;
  close: () => Promise<void>;
  tree: ReleaseTreeSteps;
  release: string | null;
  withClickHouse: boolean;
  processId: string;
  firstInstall: FirstInstallUpgrade;
  credentialKeys?: readonly string[];
  /** Every ClickHouse target the environment configures; a private one with no ledger rows
   *  counts as behind, so the worker's catch-up pass runs the upgrade that seeds it. */
  clickhouseTargets?: readonly string[];
  /** The shared list of private ClickHouse targets catching up (T7-F18); null without Redis. */
  targetsCatchingUp?: TargetsCatchingUpStore | null;
  warn?: ServingGateWarn;
  /** The worker's pause between asks; tests pass their own. */
  wait?: (ms: number) => Promise<unknown>;
  /** Store URLs the process resolved, masked in what a step's error or log line quotes. */
  secretValues?: readonly (string | undefined)[];
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
  const findRuns = async () => ((await runner.ledgerExists()) ? ledger.findRuns() : []);
  const gate = createUpgradeGate({
    role,
    processId,
    image: { release, blockingSteps, name: release ?? "unreleased", declaredSteps },
    ledger: {
      findSteps: async () => ((await runner.ledgerExists()) ? ledger.findSteps() : []),
      findRuns,
      findSeedSteps: async () => prismaSteps({ rows: await readPrismaMigrations({ postgres }) }),
    },
    roster,
    credentialKeys,
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
  const blocking = new Set(blockingSteps);
  const findBlockingFailures = async () =>
    (await findFailedSteps()).filter(({ id }) => blocking.has(id));
  const findUnresolvedFailures = async () =>
    unresolvedFailures({ failed: await findBlockingFailures(), postgres });
  const findLeaseHolder = () => liveLeaseHolder({ runner });
  const connection = gateConnection({ close });
  return {
    async admit(): Promise<ServingVerdict> {
      try {
        const verdict =
          (await uncreatableLedger({ runner })) ??
          (role === "worker"
            ? await admitAfterFirstInstall({
                gate,
                firstInstall,
                warn,
                findFailedSteps: findUnresolvedFailures,
                findLeaseHolder,
                wait,
              })
            : await failedFirstInstallRun({
                verdict: await gate.admit(),
                findFailedSteps: findBlockingFailures,
                findRuns,
              }));
        await connection.answered(verdict);
        return verdict;
      } catch (error) {
        await connection.failed();
        throw error;
      }
    },
    async release() {
      try {
        await gate.release();
      } finally {
        await connection.close();
        await targetsCatchingUp?.close();
      }
    },
    serving: () => gate.serving(),
    ...(targetsCatchingUp === null
      ? {}
      : {
          watchTargetsCatchingUp: (onChange: (organizationIds: readonly string[]) => void) =>
            watchTargetsCatchingUp({ store: targetsCatchingUp, onChange }),
        }),
    ...consoleRetryFor({ role, findFailures: findBlockingFailures, runner }),
    ...(role === "worker"
      ? {
          backgroundSteps: backgroundStepsOver({
            postgres,
            roster,
            gate,
            processId,
            release,
            warn,
            catchUp: { upgrade: firstInstall, findLeaseHolder, targetsCatchingUp },
            clickhouseTargets,
            redact: ledgerRedactor({ secretValues }),
          }),
        }
      : {}),
  };
}

const logTailSchema = z.array(z.string()).catch([]);
/** A failed run's report: a schema phase failure writes its error here, never on a step row. */
const failedReportSchema = z
  .object({ logTail: logTailSchema, error: z.string().nullable().catch(null).default(null) })
  .catch({ logTail: [], error: null });

/** The api's console Retry: each failed blocking step back to `pending` (UIW-7, Q10). */
function consoleRetryFor({
  role,
  findFailures,
  runner,
}: {
  role: ServingRole;
  findFailures: () => Promise<UpgradeFailedRun["failedSteps"]>;
  runner: Pick<UpgradeRunnerRepository, "retryFailedStep">;
}) {
  if (role !== "api") return {};
  return {
    retryFailedSteps: async () => {
      for (const { id } of await findFailures()) await runner.retryFailedStep({ id });
    },
  };
}

type LedgerRun = Pick<UpgradeRun, "kind" | "outcome" | "report">;

/**
 * UIW-7, NO-HOLDS: an api whose installation never finished an upgrade run (the seed's run does
 * not count) reads the failure for the token console; a failed schema phase writes no step row,
 * so a failed last finished run opens it too, its error closing the log tail.
 */
export async function failedFirstInstallRun({
  verdict,
  findFailedSteps,
  findRuns,
}: {
  verdict: ServingVerdict;
  findFailedSteps: () => Promise<UpgradeFailedRun["failedSteps"]>;
  findRuns: () => Promise<readonly LedgerRun[]>;
}): Promise<ServingVerdict> {
  if (verdict.outcome !== "upgrading") return verdict;
  const runs = await findRuns();
  if (runs.some((run) => run.kind === "upgrade" && run.outcome === "succeeded")) return verdict;
  const failedSteps = await findFailedSteps();
  const lastFinished = runs.findLast((run) => run.kind === "upgrade" && run.outcome !== null);
  if (failedSteps.length === 0 && lastFinished?.outcome !== "failed") return verdict;
  const report = runs.findLast((run) => run.kind === "upgrade" && run.outcome === "failed")?.report;
  const { logTail, error } = failedReportSchema.parse(report ?? {});
  const named =
    error === null || failedSteps.length > 0 || logTail.some((line) => line.includes(error));
  return { ...verdict, failedRun: { failedSteps, logTail: named ? logTail : [...logTail, error] } };
}

/** Who holds the upgrade lease now, or null when it is free (a lapsed lease is free). */
export type UpgradeLeaseHolder = () => Promise<Pick<
  UpgradeLease,
  "owner" | "host" | "image"
> | null>;

/** Where a role that cannot create the ledger is sent (Alex, 2026-10-10, option a). */
export const UPGRADE_DOCS = "docs/self-hosting/upgrade.mdx";

/** The refusal of a role that can neither create the ledger schema nor write a pre-created one. */
export function ledgerNotCreatableRefusal({ schema }: { schema: string }): string {
  return (
    `the upgrade ledger does not exist and the DATABASE_URL role cannot create it: grant the role ` +
    `CREATE on the database, or create the schema "${schema}" owned by the role beforehand ` +
    `(${UPGRADE_DOCS}), then start this process again.`
  );
}

/** A missing ledger this role may create is the worker's to create; one it may not is refused. */
async function uncreatableLedger({
  runner,
}: {
  runner: Pick<UpgradeRunnerRepository, "ledgerExists" | "ledgerCreatable" | "ledgerSchema">;
}): Promise<ServingVerdict | null> {
  if ((await runner.ledgerExists()) || (await runner.ledgerCreatable())) return null;
  const refusal = ledgerNotCreatableRefusal({ schema: await runner.ledgerSchema() });
  return { admitted: false, outcome: "ledger-not-creatable", refusal };
}

/** An upgrading api keeps the connection: it asks again over it. */
const closesOn = (verdict: ServingVerdict) => !verdict.admitted && verdict.outcome !== "upgrading";

/** Closes on a refusal or an error, except once the api asks on over it, until `release`. */
function gateConnection({ close }: { close: () => Promise<void> }) {
  let closed: Promise<void> | null = null;
  let askingOn = false;
  const closeOnce = () => (closed ??= close());
  return {
    close: closeOnce,
    answered: async (verdict: ServingVerdict) => {
      askingOn ||= verdict.outcome === "upgrading";
      if (closesOn(verdict) && !askingOn) await closeOnce();
    },
    failed: async () => {
      if (!askingOn) await closeOnce();
    },
  };
}

async function liveLeaseHolder({ runner }: { runner: UpgradeRunnerRepository }) {
  if (!(await runner.ledgerExists())) return null;
  return runner.findLiveLease({ name: UPGRADE_LEASE_NAME });
}

/**
 * A failed Prisma step whose `_prisma_migrations` row an operator since resolved, applied or
 * rolled back, waits no more: the worker runs the upgrade again by itself (T9-F2).
 */
export async function unresolvedFailures({
  failed,
  postgres,
}: {
  failed: UpgradeFailedRun["failedSteps"];
  postgres: UpgradePostgres;
}): Promise<UpgradeFailedRun["failedSteps"]> {
  if (!failed.some(({ id }) => id.startsWith("prisma:"))) return failed;
  const history = await readPrismaMigrations({ postgres }).catch(() => null);
  if (history === null) return failed;
  const rows = prismaSteps({ rows: history });
  const status = new Map(rows.map((step) => [step.id, step.status]));
  const waiting = (id: string) =>
    !id.startsWith("prisma:") || (status.get(id) ?? "failed") === "failed";
  return failed.filter(({ id }) => waiting(id));
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
    line:
      `the upgrade failed on ${ids}; this worker waits for a Retry in Ops > Upgrades, or for a ` +
      `failed Prisma migration to be resolved as its message says, and then runs it by itself`,
    waitingOn: "a Retry",
  };
}

/** The line names at most five ids; `pnpm task upgrade status` lists every one (T0-F5). */
const NAMED_STEPS = 5;

function stepsNotDone(outstanding: readonly string[]): string {
  const count = `${outstanding.length} ${outstanding.length === 1 ? "step" : "steps"} not done`;
  const more = outstanding.length > NAMED_STEPS ? ", …" : "";
  return `${count}: ${outstanding.slice(0, NAMED_STEPS).join(", ")}${more}`;
}

function sayRun({ verdict, warn }: { verdict: ServingVerdict; warn: ServingGateWarn }): void {
  const why =
    verdict.outcome === "first-install"
      ? "first install: the ledger and the schema are empty"
      : `behind this image: ${stepsNotDone("outstanding" in verdict ? verdict.outstanding : [])}`;
  warn(`${why}, so this worker runs the upgrade itself before it takes jobs; its lines follow`, {
    phase: verdict.outcome,
    waitingOn: "the upgrade",
    next: "nothing to do: the worker takes jobs when the upgrade finishes",
  });
}

/** Whether the worker stops asking; one that said it was behind also says it caught up. */
function settled({
  verdict,
  wasBehind,
  warn,
}: {
  verdict: ServingVerdict;
  wasBehind: boolean;
  warn: ServingGateWarn;
}): boolean {
  if (verdict.outcome === "first-install" || verdict.outcome === "behind") return false;
  if (wasBehind && verdict.admitted) {
    warn("the upgrade finished: the installation is current, so this worker takes jobs", {
      phase: "current",
      next: "nothing to do",
    });
  }
  return true;
}

/**
 * The worker runs `upgrade` while its installation is behind (UPGRADE-IN-WORKER): it waits while
 * another runner holds the lease, after a failed step for a Retry, after a failure with no failed
 * step retries on a backoff (STUCK-STATES).
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
  let retries = 0;
  let wasBehind = false;
  for (;;) {
    const verdict = await gate.admit();
    if (settled({ verdict, wasBehind, warn })) return verdict;
    wasBehind = true;
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
    const { code, logTail } = await firstInstall();
    ranClean = code === "done";
    if (ranClean) {
      retries = 0;
      continue;
    }
    // After any run a failed step waits for a Retry; a lease loser's exit is not a failure.
    mayRunPastFailure = false;
    retries = await waitAfterFailedRun({
      run: { verdict, code, logTail },
      retries,
      findFailedSteps,
      warn,
      wait,
      reAskMs,
    });
  }
}

/** The longest a worker waits between runs that fail with no failed step (STUCK-STATES). */
export const UPGRADE_RETRY_MAX_MS = 5 * 60_000;

/** Waits after a failed run; answers the count of back-to-back failures with no failed step. */
async function waitAfterFailedRun({
  run: { verdict, code, logTail },
  retries,
  findFailedSteps,
  warn,
  wait,
  reAskMs,
}: {
  run: { verdict: ServingVerdict; code: UpgradeOutcomeCode; logTail: readonly string[] };
  retries: number;
  findFailedSteps: () => Promise<UpgradeFailedRun["failedSteps"]>;
  warn: ServingGateWarn;
  wait: (ms: number) => Promise<unknown>;
  reAskMs: number;
}): Promise<number> {
  const lost = code === "lease_not_acquired";
  const failed = lost ? [] : await findFailedSteps().catch(() => []);
  if (lost || failed.length > 0) {
    if (failed.length > 0) warnFailedRun({ verdict, code, warn });
    await wait(reAskMs);
    return 0;
  }
  const retryInMs = Math.min(reAskMs * 2 ** retries, UPGRADE_RETRY_MAX_MS);
  const cause = logTail.at(-1) ?? "it printed nothing";
  warn(
    `\`${UPGRADE_COMMAND}\` ended ${code} with no failed step to retry (last line: ${cause}); this worker retries it in ${retryInMs / 1000} s`,
    {
      phase: verdict.outcome,
      waitingOn: "the retry backoff",
      retryInMs,
      next: "nothing to do if the cause passes; otherwise fix what the run's lines name",
    },
  );
  await wait(retryInMs);
  return retries + 1;
}

function warnFailedRun({
  verdict,
  code,
  warn,
}: {
  verdict: ServingVerdict;
  code: UpgradeOutcomeCode;
  warn: ServingGateWarn;
}): void {
  warn(`\`${UPGRADE_COMMAND}\` ended ${code}; this worker waits for a Retry`, {
    phase: verdict.outcome,
    waitingOn: "a Retry",
    next:
      "retry the failed step from Ops > Upgrades or the upgrade console, or resolve a failed " +
      "Prisma migration as the run's message says; this worker then runs the upgrade by itself",
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
  catchUp,
  clickhouseTargets,
  redact,
}: {
  postgres: UpgradePostgres;
  roster: Pick<ServingRoster, "oldWritersGoneFor">;
  gate: Pick<UpgradeGate, "serving">;
  processId: string;
  release: string | null;
  warn: ServingGateWarn;
  /** Runs the upgrade again while a held private ClickHouse target is behind (T7-F1). */
  catchUp: {
    upgrade: FirstInstallUpgrade;
    findLeaseHolder: UpgradeLeaseHolder;
    targetsCatchingUp: TargetsCatchingUpStore | null;
  };
  clickhouseTargets: readonly string[];
  redact: LedgerTextRedactor;
}) {
  const ledger = UpgradeLedgerRepository.create({ postgres, redact });
  const runner = UpgradeRunnerRepository.create({ postgres, redact });
  const log = (level: "info" | "warn", message: string, fields: object) =>
    level === "warn" ? warn(message, { processId, ...fields }) : undefined;
  return {
    isStep: isDeclaredMigrationStep,
    start: (steps: readonly unknown[], queue?: BackgroundStepsQueue) => {
      const service = BackgroundStepsService.create({
        ledger: {
          findSteps: () => ledger.findSteps(),
          acquireLease: (input) => ledger.acquireLease(input),
          renewLease: (input) => ledger.renewLease(input),
          releaseLease: (input) => ledger.releaseLease(input),
          markRunning: (input) => runner.markRunning(input),
          setStatus: (input) => runner.setStatus(input),
          saveReport: (input) => runner.saveReport(input),
          reopen: (input) => runner.reopenDoneSteps({ ...input, from: "running" }),
        },
        steps: steps.filter(isMigrationStep),
        serving: () => gate.serving(),
        oldWritersGoneFor: (input) => roster.oldWritersGoneFor(input),
        identity: { owner: processId, image: release ?? "unreleased", host: hostname() },
        log,
        redact,
        ...(queue === undefined ? {} : { queue }),
      });
      const sweeping = startBackgroundSteps({ service, log });
      const catchingUp = startTargetCatchUp({
        findTargetsBehind: async () => {
          if (!(await runner.ledgerExists())) return [];
          return privateTargetsBehind({
            behind: (await ledger.findTargetsBehind()).map(({ target }) => target),
            recorded: await ledger.findRecordedTargets(),
            configured: clickhouseTargets,
          });
        },
        findLeaseHolder: catchUp.findLeaseHolder,
        upgrade: catchUp.upgrade,
        ...(catchUp.targetsCatchingUp === null
          ? {}
          : { shareTargetsBehind: shareOver({ store: catchUp.targetsCatchingUp }) }),
        warn: (message, fields) => warn(message, { processId, ...fields }),
        maxMs: UPGRADE_RETRY_MAX_MS,
      });
      return {
        stop: async () => {
          await catchingUp.stop();
          await sweeping.stop();
        },
      };
    },
  };
}

/** The ledger names a private target `private:<organizationId>`; the list holds organisations. */
function shareOver({ store }: { store: TargetsCatchingUpStore }) {
  return (targets: readonly string[]) =>
    store.write({
      organizationIds: targets.map((target) => target.slice(PRIVATE_TARGET_PREFIX.length)),
    });
}

/** The gate's statements give up rather than hold its one connection (gate review, 2026-10-10). */
export const GATE_STATEMENT_TIMEOUT_MS = 15_000;

/** Client side, for a connection that stops answering at all: a little past the server's own. */
export const GATE_QUERY_TIMEOUT_MS = 20_000;

/** The gate's one connection, in the schema `?schema=` names, where the runner wrote the ledger. */
export function gatePoolConfig({ databaseUrl }: { databaseUrl: string }): pg.PoolConfig {
  const schema = URL.canParse(databaseUrl) ? new URL(databaseUrl).searchParams.get("schema") : null;
  return {
    connectionString: databaseUrl,
    max: 1,
    allowExitOnIdle: true,
    statement_timeout: GATE_STATEMENT_TIMEOUT_MS,
    query_timeout: GATE_QUERY_TIMEOUT_MS,
    ...(schema
      ? { options: `-c search_path="${schema}" -c TimeZone=UTC` }
      : { options: "-c TimeZone=UTC" }),
  };
}

/** An idle gate connection lost to Postgres is reported, not thrown; silent once the pool ends. */
export function guardGatePool({ pool, warn }: { pool: pg.Pool; warn: ServingGateWarn }): pg.Pool {
  pool.on("error", (error) => {
    if (!pool.ending) warn("gate connection lost while idle", { error: messageOf(error) });
  });
  return pool;
}

/** The tree both serving roles gate on: the schema it ships and the tasks process's code steps. */
export function servingImageTree({
  codeStepsFile = IMAGE_CODE_STEPS_FILE,
}: { codeStepsFile?: string } = {}): ReleaseTreeSteps {
  return readImageTree({ codeSteps: readImageCodeSteps({ file: codeStepsFile }) });
}

/** A gate that can also run the upgrade once and answer its exit code: `pnpm task upgrade`. */
export type ServingUpgradeGate = UpgradeGate & Readonly<{ runOnce?: () => Promise<number> }>;

/** Said by a run-once upgrade with no DATABASE_URL: there is no installation to upgrade. */
const NO_DATABASE_LINE = {
  level: "error",
  message: "DATABASE_URL is required to upgrade",
  fields: { phase: "preflight", next: "set DATABASE_URL, then run `pnpm task upgrade` again" },
} as const;

/**
 * `withUpgradeGate`'s factory for the api and worker: one connection of its own from the stores'
 * `DATABASE_URL`, opened only when the gate first asks. The worker runs the upgrade in this process
 * over `bootModules` (Alex, 2026-10-11). Specs: serving-gate.feature and entry-points.feature.
 */
export async function servingUpgradeGate({
  secrets,
  role,
  environment = {},
  bootModules,
  warn,
}: {
  secrets: ScopedSecrets;
  role: ServingRole;
  /** The process environment, under the resolved store URLs, for the Prisma and goose programs. */
  environment?: Readonly<Record<string, string | undefined>>;
  /** Boots the installed list in the tasks role; the api is handed none and never runs a step. */
  bootModules?: BootUpgradeModules;
  warn?: ServingGateWarn;
}): Promise<ServingUpgradeGate> {
  const tree = servingImageTree();
  const release = imageRelease({ manifests: loadReleases().manifests, tree });
  return secrets.into(storesOwner.secrets.database, (database) =>
    secrets.into(storesOwner.secrets.clickhouse, (clickhouse) =>
      secrets.into(storesOwner.secrets.clickhouseRoutes, (routes) =>
        withStoreUrls(secrets, ({ redis, credentialKeys }) => {
          const databaseUrl = database?.trim();
          if (!databaseUrl) return { ...NO_LEDGER_GATE, runOnce: refuseWithoutDatabase };
          const upgradeEnvironment = upgradeEnvironmentOver({
            environment,
            databaseUrl,
            clickhouse,
          });
          const stores = { bootModules, databaseUrl, redis, environment: upgradeEnvironment };
          const upgrade = upgradeIn({ ...stores, admitAtBlockingDone: true });
          const runOnce = async () =>
            EXIT_CODES[(await upgradeIn({ ...stores, admitAtBlockingDone: false })()).code];
          if (!clickhouse?.trim() && routes.size === 0) return { ...NO_CLICKHOUSE_GATE, runOnce };
          const pool = guardGatePool({
            pool: new pg.Pool(gatePoolConfig({ databaseUrl })),
            warn: warn ?? emitWarning,
          });
          const gate = upgradeGateOver({
            role,
            postgres: pool,
            close: () => pool.end(),
            tree,
            release,
            withClickHouse: true,
            processId: `${hostname()}:${process.pid}:${role}`,
            firstInstall: upgrade,
            credentialKeys,
            clickhouseTargets: configuredClickHouseTargets({ environment: upgradeEnvironment }),
            targetsCatchingUp: redisTargetsCatchingUp({
              url: redis?.trim() || undefined,
              environment,
            }),
            warn,
            secretValues: [databaseUrl, clickhouse, redis, ...routes.values()],
          });
          return { ...gate, runOnce };
        }),
      ),
    ),
  );
}

/**
 * The environment the in-process upgrade runs under: the process's, with the resolved store
 * secrets set. The gate reads its ClickHouse targets from this same environment, so the targets
 * it counts behind are exactly the ones the upgrade it triggers sees and seeds.
 */
export function upgradeEnvironmentOver({
  environment,
  databaseUrl,
  clickhouse,
}: {
  environment: Readonly<Record<string, string | undefined>>;
  databaseUrl: string;
  clickhouse: string | undefined;
}): Readonly<Record<string, string | undefined>> {
  const sharedUrl = clickhouse?.trim();
  return {
    ...environment,
    DATABASE_URL: databaseUrl,
    ...(sharedUrl ? { CLICKHOUSE_URL: sharedUrl } : {}),
  };
}

/** The upgrade this process runs: in-process over its modules, or a refusal where it has none. */
function upgradeIn({
  bootModules,
  databaseUrl,
  redis,
  environment,
  admitAtBlockingDone,
}: {
  bootModules: BootUpgradeModules | undefined;
  databaseUrl: string;
  redis: string | undefined;
  /** The upgrade's environment, from `upgradeEnvironmentOver`. */
  environment: Readonly<Record<string, string | undefined>>;
  /** True for the serving worker, which takes jobs while the run's reconcilers finish. */
  admitAtBlockingDone: boolean;
}): FirstInstallUpgrade {
  if (!bootModules) return refuseWithoutModules;
  return inProcessUpgrade({
    boot: bootModules,
    databaseUrl,
    environment,
    development: environment.NODE_ENV === "development",
    admitAtBlockingDone,
    openPublisher: redisReadHintPublisher({ url: redis?.trim() || undefined, environment }),
  });
}

/** The worker's Redis URL, for the run's read hints, beside the credential key fingerprints. */
function withStoreUrls<T>(
  secrets: ScopedSecrets,
  build: (urls: { redis: string | undefined; credentialKeys: string[] }) => T | Promise<T>,
): Promise<T> {
  return secrets.into(storesOwner.secrets.redis, (redis) =>
    withCredentialKeys(secrets, (credentialKeys) => build({ redis, credentialKeys })),
  );
}

async function refuseWithoutDatabase(): Promise<number> {
  writeUpgradeLine(NO_DATABASE_LINE);
  return EXIT_CODES.failed;
}

/** A process composed without its modules cannot run the upgrade; only the worker is given them. */
const refuseWithoutModules: FirstInstallUpgrade = async () => ({
  code: "failed",
  logTail: ["this process was not handed its installed modules, so it cannot run the upgrade"],
});

/** Fingerprints of the keys this process seals and opens credentials with (Alex, 2026-10-09). */
function withCredentialKeys<T>(
  secrets: ScopedSecrets,
  build: (credentialKeys: string[]) => T | Promise<T>,
): Promise<T> {
  return secrets.into(storesOwner.secrets.encryption, (credentials) =>
    secrets.into(storesOwner.secrets.encryptionFallback, (session) =>
      secrets.into(storesOwner.secrets.encryptionPrevious, (previous) =>
        build(
          [(credentials ?? session)?.trim(), previous?.trim()]
            .filter((key): key is string => Boolean(key))
            .map((hex) => credentialKeyFingerprint({ hex })),
        ),
      ),
    ),
  );
}
