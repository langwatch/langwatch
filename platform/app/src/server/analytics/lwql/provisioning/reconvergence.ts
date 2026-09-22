/**
 * The server-side reconvergence watch that closes the chart-upgrade window.
 *
 * On a helm upgrade the app can boot while the previous ClickHouse pod still
 * serves `users.d/lwql.yaml`, so the deploy task (`provisionLwql`) skips the
 * access-model DDL as config-store-owned (495). That task is a short-lived
 * process — it returns and exits, so it cannot wait the window out. Instead the
 * long-running app server arms this watch once it is listening.
 *
 * The watch polls a *stateless* ownership probe on an exponential backoff: at
 * every tick the probe reports which store owns the model right now —
 * `"config_store"` (old pod still rendering it), `"sql_store"` (the app-owned
 * model is live), or `"none"`. The decision is taken from that snapshot alone,
 * never inferred from probe history, so a transient probe error can never
 * fabricate a re-provision against a healthy install, and a pod that rolled
 * before the first probe still reads correctly. Only a probe that authoritatively
 * reports `"none"` re-provisions, and it does so exactly once.
 *
 * Both the probe and the converge are injected — `provisionLwql` exports the
 * real implementations (`lwqlAccessModelOwner` and `selfProvisionAll`) so the
 * env/name derivation is not duplicated, and this module stays free of the
 * database graph and unit-testable with fakes.
 *
 * @see ../../../../tasks/provisionLwql.ts
 * @see ./clickhouseStatementRunner.ts — inventoryConfigStoreLwqlEntities
 * @see specs/lwql/api.feature
 */

import { createLogger } from "@langwatch/observability";

import type { LwqlAccessModelOwner } from "../../../../tasks/provisionLwql";

const logger = createLogger("langwatch:analytics:lwql:reconvergence");

const DEFAULT_INITIAL_DELAY_MS = 5_000;
const DEFAULT_MAX_DELAY_MS = 5 * 60_000;
const DEFAULT_BUDGET_MS = 30 * 60_000;

export interface LwqlReconvergenceWatch {
  /** Cancels any pending poll. Idempotent. */
  stop(): void;
}

/**
 * Armed once per process: the app server calls {@link startLwqlReconvergenceWatch}
 * exactly once, and this guards against a second arming stacking a parallel poll
 * loop. Reset only by the test helper below.
 */
let watchArmed = false;

/**
 * Resets the once-per-process guard. Test-only — production arms the watch once
 * for the life of the server.
 */
export function resetLwqlReconvergenceWatchForTests(): void {
  watchArmed = false;
}

/**
 * Polls the stateless ownership probe on an exponential backoff and
 * re-provisions the app-owned model the moment a probe reports `"none"`. State
 * lives on the instance so each step (`arm`/`tick`/the handlers) stays small;
 * the exported factory below owns the once-per-process guard.
 */
class ReconvergenceWatcher {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private elapsedMs = 0;
  private delayMs: number;
  // Log-dedupe only: emit the "config store still owns it" info line once, not
  // on every poll while we wait the window out. Never used for a decision.
  private announced = false;
  private stopped = false;

  private readonly probe: () => Promise<LwqlAccessModelOwner>;
  private readonly converge: () => Promise<void>;
  private readonly maxDelayMs: number;
  private readonly budgetMs: number;

  constructor(options: {
    probe: () => Promise<LwqlAccessModelOwner>;
    converge: () => Promise<void>;
    initialDelayMs: number;
    maxDelayMs: number;
    budgetMs: number;
  }) {
    this.probe = options.probe;
    this.converge = options.converge;
    this.maxDelayMs = options.maxDelayMs;
    this.budgetMs = options.budgetMs;
    this.delayMs = options.initialDelayMs;
  }

  start(): void {
    this.arm();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private arm(): void {
    if (this.stopped) return;
    // Give up once the next wait would exceed the budget: a config-store access
    // model that is never removed would otherwise poll forever.
    if (this.elapsedMs + this.delayMs > this.budgetMs) {
      logger.warn(
        { budgetMinutes: Math.round(this.budgetMs / 60_000) },
        "lwql reconvergence watch gave up: the ClickHouse config store still owns the LangWatchQL access model after the budget expired — the app-owned model stays yielded until the next boot",
      );
      this.stop();
      return;
    }
    this.timer = setTimeout(() => {
      void this.tick();
    }, this.delayMs);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    this.elapsedMs += this.delayMs;
    this.delayMs = Math.min(this.delayMs * 2, this.maxDelayMs);

    let owner: LwqlAccessModelOwner;
    try {
      owner = await this.probe();
    } catch (error) {
      // A probe failure is never a decision: the ownership snapshot is unknown,
      // so keep polling. It never re-provisions on its own.
      logger.debug(
        { error },
        "lwql reconvergence probe failed — the ClickHouse config store is unreadable (pod rolling?), still waiting",
      );
      this.arm();
      return;
    }

    if (owner === "sql_store") {
      // The app-owned model is already live — nothing to reconverge.
      logger.debug(
        "lwql reconvergence watch: the app-owned LangWatchQL model is present in the ClickHouse SQL store, nothing to reconverge",
      );
      this.stop();
      return;
    }

    if (owner === "config_store") {
      this.announceOwnership();
      this.arm();
      return;
    }

    await this.reprovision();
  }

  private announceOwnership(): void {
    if (this.announced) return;
    this.announced = true;
    logger.info(
      "the ClickHouse config store still owns the LangWatchQL access model, the app will re-provision once it releases it",
    );
  }

  private async reprovision(): Promise<void> {
    // The probe authoritatively reports neither store owns the model — the
    // upgrade window has closed (or the pod rolled before the first probe).
    // Re-provision the app-owned model once. converge() is fail-closed on its
    // own errors and never throws; the catch is defensive.
    try {
      await this.converge();
      logger.info(
        "lwql reconvergence: the ClickHouse config store no longer owns the LangWatchQL access model and the app-owned model is absent — re-provisioned it",
      );
    } catch (error) {
      logger.error(
        { error },
        "lwql reconvergence: re-provisioning after the config store released the access model failed — fail-closed until the next boot",
      );
    }
    this.stop();
  }
}

/**
 * Polls the stateless LangWatchQL ownership probe on an exponential backoff and
 * re-provisions the app-owned model once a probe reports the model is neither
 * config-store-owned nor present in the SQL store.
 *
 * - `probe()` returns which store owns the model *right now*. A probe that
 *   throws (e.g. the ClickHouse pod is mid-roll) is logged at debug and treated
 *   as "still waiting" — a failure alone never re-provisions.
 * - `"sql_store"`: the app-owned model is already live; log at debug and stop.
 * - `"config_store"`: the old pod still owns it; log once at info and keep
 *   polling.
 * - `"none"`: neither store owns it (window closed, or a pod rolled before the
 *   first probe); call `converge()` once (idempotent, under its own advisory
 *   lock), log at info, and stop.
 * - It gives up at `budgetMs` with a single warn.
 *
 * The first poll fires after `initialDelayMs` (default 5s) so a pod that rolled
 * before the server began listening is caught within seconds; the backoff then
 * doubles to `maxDelayMs`. Every timer is `unref`'d, so a pending poll never
 * holds the process open, and {@link LwqlReconvergenceWatch.stop} clears any
 * pending timer for graceful shutdown. Armed at most once per process (see
 * {@link watchArmed}).
 */
export function startLwqlReconvergenceWatch({
  probe,
  converge,
  initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
  maxDelayMs = DEFAULT_MAX_DELAY_MS,
  budgetMs = DEFAULT_BUDGET_MS,
}: {
  probe: () => Promise<LwqlAccessModelOwner>;
  converge: () => Promise<void>;
  initialDelayMs?: number;
  maxDelayMs?: number;
  budgetMs?: number;
}): LwqlReconvergenceWatch {
  if (watchArmed) {
    // Already armed for this process — hand back an inert handle rather than
    // stacking a second poll loop.
    return { stop: () => undefined };
  }
  watchArmed = true;

  const watcher = new ReconvergenceWatcher({
    probe,
    converge,
    initialDelayMs,
    maxDelayMs,
    budgetMs,
  });
  watcher.start();
  return { stop: () => watcher.stop() };
}
