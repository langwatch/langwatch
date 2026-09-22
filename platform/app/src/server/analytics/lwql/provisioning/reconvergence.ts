/**
 * The server-side reconvergence watch that closes the chart-upgrade window.
 *
 * On a helm upgrade the app can boot while the previous ClickHouse pod still
 * serves `users.d/lwql.yaml`, so the deploy task (`provisionLwql`) skips the
 * access-model DDL as config-store-owned (495). That task is a short-lived
 * process — it returns and exits, so it cannot wait the window out. Instead the
 * long-running app server arms this watch once it is listening: it polls the
 * ClickHouse config store, and the moment the old pod's rendered model is gone
 * (the config store owns zero LangWatchQL entities) it re-provisions the
 * app-owned model exactly once.
 *
 * Both the probe and the converge are injected — `provisionLwql` exports the
 * real implementations (`configStoreOwnedLwqlEntityCount` and
 * `selfProvisionAll`) so the env/name derivation is not duplicated, and this
 * module stays free of the database graph and unit-testable with fakes.
 *
 * @see ../../../../tasks/provisionLwql.ts
 * @see ./clickhouseStatementRunner.ts — inventoryConfigStoreLwqlEntities
 * @see specs/lwql/api.feature
 */

import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:analytics:lwql:reconvergence");

const DEFAULT_INITIAL_DELAY_MS = 30_000;
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
 * Polls the ClickHouse config store on an exponential backoff and re-provisions
 * the app-owned model once the store releases it. State lives on the instance so
 * each step (`arm`/`tick`/the release handler) stays small; the exported factory
 * below owns the once-per-process guard.
 */
class ReconvergenceWatcher {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private elapsedMs = 0;
  private delayMs: number;
  // Whether any probe has yet seen the config store own the model. Distinguishes
  // "first probe found nothing, no window" from "the window has now closed".
  private sawOwnership = false;
  // Whether any probe has failed. A failure means ClickHouse was mid-roll — the
  // exact window this watch closes — so a clean 0 that follows a failure is "the
  // pod rolled and the new one owns nothing", not "no window", even if no probe
  // ever read ownership directly.
  private sawFailure = false;
  private stopped = false;

  private readonly probe: () => Promise<number>;
  private readonly converge: () => Promise<void>;
  private readonly maxDelayMs: number;
  private readonly budgetMs: number;

  constructor(options: {
    probe: () => Promise<number>;
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

    let owned: number;
    try {
      owned = await this.probe();
    } catch (error) {
      this.sawFailure = true;
      logger.debug(
        { error },
        "lwql reconvergence probe failed — the ClickHouse config store is unreadable (pod rolling?), still waiting",
      );
      this.arm();
      return;
    }

    if (owned > 0) {
      this.announceOwnership(owned);
      this.arm();
      return;
    }

    await this.handleReleased();
  }

  private announceOwnership(owned: number): void {
    if (this.sawOwnership) return;
    this.sawOwnership = true;
    logger.info(
      { owned },
      `ClickHouse config store still owns ${owned} LangWatchQL entit${
        owned === 1 ? "y" : "ies"
      }, the app will re-provision once it releases them`,
    );
  }

  private async handleReleased(): Promise<void> {
    if (!this.sawOwnership && !this.sawFailure) {
      // First successful probe found nothing owned and no probe had failed:
      // there was no upgrade window. Debug only — the steady-state boot path.
      logger.debug(
        "lwql reconvergence watch: the ClickHouse config store owns no LangWatchQL entities, nothing to reconverge",
      );
      this.stop();
      return;
    }

    // The window has closed — re-provision the app-owned model once. This is
    // either the config store releasing a model it owned, or a clean read after
    // a probe failure (ClickHouse rolled while we polled, and the new pod owns
    // nothing): both mean the app should now own the model. converge() is
    // fail-closed on its own errors and never throws; the catch is defensive.
    const afterProbeFailure = !this.sawOwnership;
    try {
      await this.converge();
      logger.info(
        { afterProbeFailure },
        afterProbeFailure
          ? "lwql reconvergence: the ClickHouse config store is now readable and owns no LangWatchQL entities (the pod finished rolling) — re-provisioned the app-owned model"
          : "lwql reconvergence: the ClickHouse config store released the LangWatchQL access model — re-provisioned the app-owned model",
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
 * Polls the ClickHouse config store on an exponential backoff and re-provisions
 * the app-owned LangWatchQL model once the config store releases it.
 *
 * - `probe()` returns the count of LangWatchQL entities the config store
 *   currently owns. A probe that throws (e.g. the ClickHouse pod is mid-roll) is
 *   logged at debug and treated as "still waiting".
 * - If the very first successful probe returns 0 and no probe has failed, there
 *   was no upgrade window: the watch logs nothing beyond debug and stops.
 * - While the count is > 0, the watch logs once at info and keeps polling.
 * - When a probe returns 0 after any probe has reported ownership OR failed
 *   (ClickHouse was mid-roll), it calls `converge()` once (idempotent, under its
 *   own advisory lock), logs at info, and stops.
 * - It gives up at `budgetMs` with a single warn.
 *
 * Every timer is `unref`'d, so a pending poll never holds the process open, and
 * {@link LwqlReconvergenceWatch.stop} clears any pending timer for graceful
 * shutdown. Armed at most once per process (see {@link watchArmed}).
 */
export function startLwqlReconvergenceWatch({
  probe,
  converge,
  initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
  maxDelayMs = DEFAULT_MAX_DELAY_MS,
  budgetMs = DEFAULT_BUDGET_MS,
}: {
  probe: () => Promise<number>;
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
