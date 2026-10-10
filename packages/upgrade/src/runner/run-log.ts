import type { UpgradePlan } from "../plan/plan-upgrade.ts";
import type { UpgradePhaseChange, UpgradePhaseName } from "./run-phases.ts";
import type { UpgradeRunnerLog } from "./schema-applier.ts";
import type { UpgradeOutcome, UpgradeOutcomeCode } from "./upgrade-outcome.ts";

/** The commands an operator is pointed at (specs/upgrade/upgrade-logging.feature). */
export const UPGRADE_RUN_COMMAND = "pnpm task upgrade";
export const UPGRADE_STATUS_COMMAND = "pnpm task upgrade status";
/** How many of the run's last lines the upgrade console shows (in-app-upgrade.feature). */
export const UPGRADE_LOG_TAIL_LINES = 50;

const RUN = `\`${UPGRADE_RUN_COMMAND}\``;
const STATUS = `\`${UPGRADE_STATUS_COMMAND}\``;
const WAIT = `nothing to do: wait for the run to finish; ${STATUS} shows its progress`;

/** What an operator does after each outcome; every failure names a command or a setting. */
export const UPGRADE_NEXT_ACTION: Readonly<Record<UpgradeOutcomeCode, string>> = {
  done: `start or restart the api and worker; ${STATUS} shows every step and run`,
  refused_below_floor: `run the LTS release the message names with ${RUN} first, then this image`,
  refused_image_below_floor: `deploy an image at or above the installation's floor, then run ${RUN}`,
  lease_not_acquired: `wait for the holder's run to finish (${STATUS}), then run ${RUN} again; a dead holder's lease expires by itself`,
  lease_lost: `run ${RUN} again: it resumes from the ledger`,
  failed_prisma_migration: `run the \`prisma migrate resolve\` command the message names (DATABASE_URL), then ${RUN} again`,
  rerunnable_migration_failed: `fix what the named migration's error names (a lock another session holds: lock_timeout), then run ${RUN} again: it marks the migration rolled back and re-runs it itself`,
  schema_failed: `check the named target is reachable (DATABASE_URL, CLICKHOUSE_URL), fix it, then run ${RUN} again`,
  step_failed: `read the step's error with ${STATUS}, fix its cause, then run ${RUN} again: the step resumes from its checkpoint`,
  reconciler_failed: `fix the store the named reconciler reaches (CLICKHOUSE_URL), then run ${RUN} again`,
  failed: `read the error above and ${STATUS}, fix the cause, then run ${RUN} again`,
};

const WAITING_ON: Readonly<Record<UpgradePhaseName, string>> = {
  preflight: "the ledger and _prisma_migrations (DATABASE_URL)",
  "postgres-schema": "prisma migrate deploy on Postgres (DATABASE_URL)",
  "clickhouse-schema": "goose on every ClickHouse target (CLICKHOUSE_URL)",
  reconcile: "the reconcilers: ClickHouse TTL, LangWatchQL and the system-migrations pass request",
};

const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/[^\s:/@]*):[^\s@/]*@/gi;
const SECRET_PAIRS =
  /\b(password|passwd|pwd|token|secret|api[_-]?key|access[_-]?key|auth)=([^\s&;,"']+)/gi;

/** A URL's password and every secret-named `key=value` masked; the user, host and path stay. */
export function redactSecrets(text: string): string {
  return text.replace(URL_CREDENTIALS, "$1:***@").replace(SECRET_PAIRS, "$1=***");
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value instanceof Error) return redactSecrets(value.message);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, each]) => [key, redactValue(each)]));
  }
  return value;
}

/** The command that marks a failed Prisma migration rolled back, as an operator would type it. */
export const resolveCommand = (migration: string) =>
  `prisma migrate resolve --rolled-back ${migration}`;

const elapsedSince = (startedAt: number) => Math.round(performance.now() - startedAt);
const countOf = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * The run's console narration over the caller's logger: every line names its phase, what it
 * waits on, the elapsed milliseconds and the operator's next action, and is redacted.
 */
export class UpgradeRunLog implements UpgradeRunnerLog {
  private startedAt = performance.now();
  /** The run's last redacted lines, for the run report the api's console reads (UIW-7). */
  private readonly lines: string[] = [];
  private readonly phaseStarts = new Map<string, number>();
  private readonly stepStarts = new Map<string, number>();

  constructor(private readonly log: UpgradeRunnerLog) {}

  /** Restarts the run clock; each `run()` narrates from its own start. */
  begin(): void {
    this.startedAt = performance.now();
    this.phaseStarts.clear();
    this.stepStarts.clear();
    this.lines.length = 0;
  }

  /** The last {@link UPGRADE_LOG_TAIL_LINES} lines this run said, redacted. */
  tail(): readonly string[] {
    return [...this.lines];
  }

  info(message: string, fields?: Record<string, unknown>): void {
    this.log.info(this.keep(redactSecrets(message)), this.fields(fields));
  }

  warn(message: string, fields?: Record<string, unknown>): void {
    this.log.warn(this.keep(redactSecrets(message)), this.fields(fields));
  }

  private keep(line: string): string {
    this.lines.push(line);
    this.lines.splice(0, Math.max(0, this.lines.length - UPGRADE_LOG_TAIL_LINES));
    return line;
  }

  firstRun(): void {
    this.info(
      "first run: this database holds no LangWatch schema. The upgrade creates its ledger in " +
        "its own Postgres schema, takes the upgrade lease, applies every migration on Postgres " +
        "and ClickHouse, then exits so the api and worker can serve",
      { phase: "first-run", waitingOn: "the upgrade ledger (DATABASE_URL)", next: WAIT },
    );
  }

  ledgerReady({ schema, startedAt }: { schema: string; startedAt: number }): void {
    const elapsedMs = elapsedSince(startedAt);
    this.info(`upgrade ledger ready in Postgres schema ${schema} after ${elapsedMs} ms`, {
      phase: "ledger",
      waitingOn: "nothing",
      phaseElapsedMs: elapsedMs,
      next: WAIT,
    });
  }

  ledgerFailed({ error }: { error: string }): void {
    this.warn(`the upgrade ledger could not be created: ${error}`, {
      phase: "ledger",
      waitingOn: "nothing",
      next: UPGRADE_NEXT_ACTION.schema_failed,
    });
  }

  planned({
    runId,
    installed,
    plan,
  }: {
    runId: string;
    installed: string | null;
    plan: Extract<UpgradePlan, { outcome: "planned" }>;
  }): void {
    const schema = plan.releases.flatMap((release) => release.schema);
    const postgres = schema.filter((id) => id.startsWith("prisma:")).length;
    const blocking = plan.releases.flatMap((release) => release.blocking).length;
    const what =
      `${countOf(schema.length, "schema migration")} (${postgres} Postgres, ` +
      `${schema.length - postgres} ClickHouse) and ${countOf(blocking, "blocking step")}`;
    const fields = { runId, installed, phase: "plan", waitingOn: "nothing", next: WAIT };
    if (plan.fresh) {
      const notNeeded = countOf(plan.notNeeded.length, "step");
      this.info(
        `first run: applying ${what}, then the api and worker serve; ${notNeeded} not needed on a fresh install`,
        { ...fields, schema: schema.length, blocking, notNeeded: plan.notNeeded.length },
      );
      return;
    }
    if (schema.length === 0 && blocking === 0) {
      this.info("upgrade planned: nothing to apply, the ledger is current", fields);
      return;
    }
    const releases = plan.releases.map((release) => release.release ?? "unreleased").join(", ");
    this.info(`upgrade planned from ${installed ?? "unknown"}: ${what} across ${releases}`, {
      ...fields,
      schema: schema.length,
      blocking,
    });
  }

  phase({ phase }: Pick<UpgradePhaseChange, "phase">): void {
    const key = `${phase.name}:${phase.release ?? ""}`;
    const label = `phase ${phase.name}${phase.release ? ` (${phase.release})` : ""}`;
    if (phase.outcome === "running") {
      this.phaseStarts.set(key, performance.now());
      const waitingOn = WAITING_ON[phase.name];
      this.info(`${label} started: waiting on ${waitingOn}`, {
        phase: phase.name,
        release: phase.release,
        waitingOn,
        next: WAIT,
      });
      return;
    }
    const phaseElapsedMs = elapsedSince(this.phaseStarts.get(key) ?? this.startedAt);
    const fields = {
      phase: phase.name,
      release: phase.release,
      waitingOn: "nothing",
      phaseElapsedMs,
    };
    if (phase.outcome === "succeeded") {
      this.info(`${label} succeeded in ${phaseElapsedMs} ms`, { ...fields, next: WAIT });
    } else {
      this.warn(`${label} failed after ${phaseElapsedMs} ms`, {
        ...fields,
        next: UPGRADE_NEXT_ACTION.failed,
      });
    }
  }

  stepStarted({
    id,
    description,
    resuming,
  }: {
    id: string;
    description: string;
    resuming: boolean;
  }): void {
    this.stepStarts.set(id, performance.now());
    const from = resuming ? "resuming from its checkpoint" : "from the start";
    this.info(`blocking step ${id} started (${from}): ${description}`, {
      phase: "blocking-step",
      step: id,
      waitingOn: `step ${id}`,
      next: WAIT,
    });
  }

  stepEnded({ id, error }: { id: string; error: string | null }): void {
    const stepElapsedMs = elapsedSince(this.stepStarts.get(id) ?? this.startedAt);
    const fields = { phase: "blocking-step", step: id, waitingOn: "nothing", stepElapsedMs };
    if (error === null)
      this.info(`blocking step ${id} done in ${stepElapsedMs} ms`, { ...fields, next: WAIT });
    else
      this.warn(`blocking step ${id} failed after ${stepElapsedMs} ms: ${error}`, {
        ...fields,
        next: UPGRADE_NEXT_ACTION.step_failed,
      });
  }

  /** A failed row an earlier run left for a re-runnable migration, resolved at preflight. */
  resolvedBeforeApply({ migration, resolveMs }: { migration: string; resolveMs: number }): void {
    this.info(
      `Prisma migration ${migration} failed in an earlier run and is re-runnable: marked it ` +
        `rolled back (${resolveCommand(migration)}) in ${resolveMs} ms; this run applies it again`,
      {
        phase: "preflight",
        migration,
        resolveElapsedMs: resolveMs,
        waitingOn: "nothing",
        next: WAIT,
      },
    );
  }

  /** A re-runnable migration that failed this attempt: resolved, retried after the backoff. */
  resolvedForRetry({
    migration,
    attempt,
    attempts,
    waitMs,
    resolveMs,
    error,
  }: {
    migration: string;
    attempt: number;
    attempts: number;
    waitMs: number;
    resolveMs: number;
    error: string | null;
  }): void {
    this.warn(
      `Prisma migration ${migration} failed on attempt ${attempt} of ${attempts} and is ` +
        `re-runnable: marked it rolled back (${resolveCommand(migration)}) in ${resolveMs} ms; ` +
        `applying it again in ${waitMs} ms. Error: ${error ?? "none given"}`,
      {
        phase: "postgres-schema",
        migration,
        attempt,
        attempts,
        waitMs,
        resolveElapsedMs: resolveMs,
        waitingOn: "the retry backoff",
        next: "nothing to do yet: the upgrade re-runs the migration itself",
      },
    );
  }

  /** The attempt after a resolve applied every migration it had marked rolled back. */
  appliedAfterResolve({ migrations, attempt }: { migrations: string[]; attempt: number }): void {
    this.info(
      `Prisma migration ${migrations.join(", ")} applied on attempt ${attempt} after it was marked rolled back`,
      { phase: "postgres-schema", migrations, attempt, waitingOn: "nothing", next: WAIT },
    );
  }

  finished({ outcome, fresh }: { outcome: UpgradeOutcome; fresh: boolean }): void {
    const { code, runId } = outcome;
    const next = UPGRADE_NEXT_ACTION[code];
    const fields = { phase: "finished", runId, code, waitingOn: "nothing", next };
    const elapsedMs = elapsedSince(this.startedAt);
    if (code === "done") {
      const what = fresh ? "first run finished" : "upgrade finished";
      this.info(`${what} in ${elapsedMs} ms: ${outcome.message}`, fields);
    } else {
      this.warn(`upgrade stopped after ${elapsedMs} ms (${code}): ${outcome.message}`, fields);
    }
  }

  private fields(fields: Record<string, unknown> | undefined): Record<string, unknown> {
    const redacted = (redactValue(fields ?? {}) as Record<string, unknown>) ?? {};
    return { elapsedMs: elapsedSince(this.startedAt), ...redacted };
  }
}
