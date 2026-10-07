import type { UpgradePlan } from "../plan/plan-upgrade.ts";
import type { UpgradePhaseChange, UpgradePhaseName } from "./run-phases.ts";
import type { UpgradeRunnerLog } from "./schema-applier.ts";
import type { UpgradeOutcome, UpgradeOutcomeCode } from "./upgrade-outcome.ts";

/** The commands an operator is pointed at (specs/upgrade/upgrade-logging.feature). */
export const UPGRADE_RUN_COMMAND = "pnpm task upgrade";
export const UPGRADE_STATUS_COMMAND = "pnpm task upgrade status";

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
  schema_failed: `check the named target is reachable (DATABASE_URL, CLICKHOUSE_URL), fix it, then run ${RUN} again`,
  step_failed: `read the step's error with ${STATUS}, fix its cause, then run ${RUN} again: the step resumes from its checkpoint`,
  reconciler_failed: `fix the store the named reconciler reaches (CLICKHOUSE_URL), then run ${RUN} again`,
  failed: `read the error above and ${STATUS}, fix the cause, then run ${RUN} again`,
};

const WAITING_ON: Readonly<Record<UpgradePhaseName, string>> = {
  preflight: "the ledger and _prisma_migrations (DATABASE_URL)",
  "postgres-schema": "prisma migrate deploy on Postgres (DATABASE_URL)",
  "clickhouse-schema": "goose on every ClickHouse target (CLICKHOUSE_URL)",
  reconcile: "the reconcilers: ClickHouse TTL and LangWatchQL",
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

const elapsedSince = (startedAt: number) => Math.round(performance.now() - startedAt);
const countOf = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * The run's console narration over the caller's logger: every line names its phase, what it
 * waits on, the elapsed milliseconds and the operator's next action, and is redacted.
 */
export class UpgradeRunLog implements UpgradeRunnerLog {
  private startedAt = performance.now();
  private readonly phaseStarts = new Map<string, number>();
  private readonly stepStarts = new Map<string, number>();

  constructor(private readonly log: UpgradeRunnerLog) {}

  /** Restarts the run clock; each `run()` narrates from its own start. */
  begin(): void {
    this.startedAt = performance.now();
    this.phaseStarts.clear();
    this.stepStarts.clear();
  }

  info(message: string, fields?: Record<string, unknown>): void {
    this.log.info(redactSecrets(message), this.fields(fields));
  }

  warn(message: string, fields?: Record<string, unknown>): void {
    this.log.warn(redactSecrets(message), this.fields(fields));
  }

  firstRun(): void {
    this.info(
      "first run: this database holds no LangWatch schema. The upgrade creates the Postgres " +
        "schema, records the ledger, applies every migration on Postgres and ClickHouse, then " +
        "exits so the api and worker can serve",
      { phase: "first-run", waitingOn: "the Postgres schema (DATABASE_URL)", next: WAIT },
    );
  }

  bootstrapped({ ok, startedAt }: { ok: boolean; startedAt: number }): void {
    const elapsedMs = elapsedSince(startedAt);
    const fields = { phase: "first-run", waitingOn: "nothing", phaseElapsedMs: elapsedMs };
    if (ok)
      this.info(`first run: Postgres schema created in ${elapsedMs} ms`, { ...fields, next: WAIT });
    else
      this.warn("first run: the Postgres schema failed", {
        ...fields,
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
