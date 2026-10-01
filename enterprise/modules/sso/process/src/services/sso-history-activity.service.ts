// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * "Something changed in this connection's history" — a bare signal the
 * organization's page refreshes on. NO NEW READ PATH: the tick calls the same
 * history read the page's own query calls, on a timer instead of a page load,
 * and only ever for the connection it was constructed with.
 */
import type { SsoActivityLogger, SsoConnectionHistoryReads } from "../app/sso.members.ts";
import {
  historyActivityChanged,
  HISTORY_ACTIVITY_POLL_MS,
} from "../rules/sso-history-activity.rules.ts";

/** What a subscriber is told: which connection moved, never what changed. */
export interface SsoHistoryActivity {
  connectionId: string;
}

/**
 * Sleeps, or wakes early when the signal fires: the loop's own guard is what
 * ends the subscription, so this only keeps an aborted wait from outliving the
 * reader who left. Two waits raced, each settling once.
 */
function sleepUnlessAborted({ ms, signal }: { ms: number; signal?: AbortSignal }): Promise<void> {
  const slept = new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
  if (!signal) return slept;

  const aborted = new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });

  return Promise.race([slept, aborted]);
}

export class SsoHistoryActivityService {
  private constructor(
    private readonly history: SsoConnectionHistoryReads,
    private readonly logger: SsoActivityLogger,
    private readonly pollMs: number,
  ) {}

  static create({
    history,
    logger,
    pollMs = HISTORY_ACTIVITY_POLL_MS,
  }: {
    history: SsoConnectionHistoryReads;
    logger: SsoActivityLogger;
    pollMs?: number;
  }): SsoHistoryActivityService {
    return new SsoHistoryActivityService(history, logger, pollMs);
  }

  async *ticks({
    organizationId,
    connectionId,
    signal,
  }: {
    organizationId: string;
    connectionId: string;
    signal?: AbortSignal;
  }): AsyncGenerator<SsoHistoryActivity> {
    let previousEventId: string | null = null;
    let observedFirstTick = false;

    while (!signal?.aborted) {
      try {
        const [latest] = await this.history.getHistory({
          organizationId,
          connectionId,
          limit: 1,
        });
        const currentEventId = latest?.eventId ?? null;
        if (
          observedFirstTick &&
          historyActivityChanged({ current: currentEventId, previous: previousEventId })
        ) {
          yield { connectionId };
        }
        previousEventId = currentEventId;
        observedFirstTick = true;
      } catch (failure) {
        // A failed read is not a change, and not a reason to close a panel
        // somebody is watching: the next tick tries again.
        this.logger.warn({ organizationId, connectionId, failure }, "sso history poll failed");
      }
      await sleepUnlessAborted({ ms: this.pollMs, signal });
    }
  }
}
