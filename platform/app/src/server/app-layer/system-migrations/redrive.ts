import type { Logger } from "@langwatch/observability";
import type { MigrationPassSummary } from "@langwatch/system-migrations";
import { type ProcessRole, roleRunsWorkers } from "../config";

/**
 * How often a long-running worker re-drives the fleet. The runner is
 * level-triggered, so the cadence only decides how long a tenant whose
 * blocker was fixed sits parked before it heals — an hour, rather than until
 * somebody restarts the fleet or clicks "run a pass".
 */
const DEFAULT_INTERVAL_MS = 60 * 60_000;

/** Backoff after a pass dies outright, so a down state table cannot hot-spin. */
const ERROR_BACKOFF_MS = 5 * 60_000;

/** Bounded wait for the loop to unwind at shutdown, like the scheduler's. */
const SHUTDOWN_MAX_WAIT_MS = 10_000;

export interface SystemMigrationRedriveDeps {
  /**
   * Whether the state table holds a tenant a pass could still move. The gate
   * that keeps this loop from sweeping every organization and every user
   * hourly on an installation that has nothing left to do.
   */
  hasTenantAwaitingRedrive: () => Promise<boolean>;
  /** The same entry the boot preflight and the ops "run a pass" action drive. */
  runPass: () => Promise<MigrationPassSummary>;
  processRole: ProcessRole | undefined;
  logger: Logger;
  intervalMs?: number;
}

/**
 * Keeps parked and held tenants moving on a long-running worker.
 *
 * The runner is level-triggered — every pass re-attempts a `parked` or
 * `migrated` tenant, and only `finalized` and `rolled_back` are terminal — so
 * a tenant whose blocker is fixed heals itself on the next pass with no manual
 * state change. What was missing is a next pass: the boot preflight converges
 * and stops, and after that the only driver was an operator on the ops page.
 * A fleet that stays up for a week left every tenant that parked in hour one
 * parked for the rest of it.
 *
 * So this is a cadence and nothing else. It composes no runner, holds no
 * state, and changes no outcome: it calls the very same pass, whose
 * per-tenant Redis claims already make concurrent passes safe (a tenant
 * another process holds is counted `claimed` and left alone), and whose
 * compare-and-set write already lets an operator's `rolled_back` pin outrank
 * anything a pass concludes. A repeated park is still not an advance, so the
 * boot preflight's convergence and pass cap are untouched — this loop never
 * consults `advanced` at all, because it is not converging on anything.
 *
 * Worker-stack-only (`roleRunsWorkers`), so the api process never drives a
 * pass; the App's graceful closeables stop it (see presets.ts).
 */
export class SystemMigrationRedriveService {
  private readonly deps: SystemMigrationRedriveDeps;
  private readonly intervalMs: number;

  private abortController = new AbortController();
  private loopPromise: Promise<void> | null = null;
  private started = false;
  private wakeCurrentSleep: (() => void) | null = null;

  constructor(deps: SystemMigrationRedriveDeps) {
    this.deps = deps;
    this.intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  }

  /** Start the loop. No-op for roles without the worker stack; idempotent. */
  start(): void {
    if (!roleRunsWorkers(this.deps.processRole)) return;
    if (this.started) return;
    this.started = true;
    if (this.abortController.signal.aborted) {
      this.abortController = new AbortController();
    }
    this.loopPromise = this.runLoop();
    this.deps.logger.info(
      { intervalMs: this.intervalMs },
      "system migration re-drive started",
    );
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.abortController.abort();
    this.wakeCurrentSleep?.();
    const loop = this.loopPromise;
    this.loopPromise = null;
    if (!loop) return;
    await Promise.race([
      loop,
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, SHUTDOWN_MAX_WAIT_MS);
        timer.unref?.();
      }),
    ]);
  }

  private async runLoop(): Promise<void> {
    const { signal } = this.abortController;
    // Sleeps FIRST: the boot preflight has just driven the fleet to
    // quiescence, so a pass at t=0 could only rediscover what it settled.
    while (!signal.aborted) {
      await this.sleep({ ms: this.intervalMs, signal });
      if (signal.aborted) return;
      const failed = await this.redriveOnce();
      if (failed && !signal.aborted) {
        await this.sleep({ ms: ERROR_BACKOFF_MS, signal });
      }
    }
  }

  /**
   * One gated pass. Returns whether it failed, so the loop can back off.
   * Never throws: a pass that dies is this tick's problem, not the worker's.
   */
  private async redriveOnce(): Promise<boolean> {
    const { hasTenantAwaitingRedrive, runPass, logger } = this.deps;
    try {
      if (!(await hasTenantAwaitingRedrive())) {
        logger.debug(
          "no parked or held tenant; skipping the system migration re-drive",
        );
        return false;
      }
      const summary = await runPass();
      logger.info({ summary }, "system migration re-drive pass complete");
      return false;
    } catch (error) {
      // Per-tenant failures park-and-log inside the pass; this catches the
      // pass itself dying (state table or tenant source down). The next tick
      // retries, as does the next boot.
      logger.error({ error }, "system migration re-drive pass failed");
      return true;
    }
  }

  private sleep({
    ms,
    signal,
  }: {
    ms: number;
    signal: AbortSignal;
  }): Promise<void> {
    if (signal.aborted) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const finish = (): void => {
        clearTimeout(timer);
        signal.removeEventListener("abort", finish);
        this.wakeCurrentSleep = null;
        resolve();
      };
      const timer = setTimeout(finish, ms);
      timer.unref?.();
      this.wakeCurrentSleep = finish;
      signal.addEventListener("abort", finish, { once: true });
    });
  }
}
