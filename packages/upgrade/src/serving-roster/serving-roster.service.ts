import type { ServingRosterEntry } from "../ledger.ts";
import {
  type ServingRosterDeclaration,
  type ServingRosterLedger,
  servingRosterDeclarationSchema,
} from "./serving-roster-ledger.ts";

export interface ServingRoster {
  record(declaration: ServingRosterDeclaration): Promise<void>;
  refresh(): Promise<void>;
  stop(): Promise<void>;
  live(): Promise<ServingRosterEntry[]>;
  oldWritersGoneFor(input: { stepId: string }): Promise<boolean>;
  /** True once this process's last good write is older than the stale bound (round 9). */
  lapsed(): boolean;
}

/** The last good write against the stale bound; a good write ends a lapse and arms the next. */
function watchLapse({
  staleAfterMs,
  onLapseChange,
}: {
  staleAfterMs: number;
  onLapseChange?: (lapsed: boolean) => void;
}) {
  let lastGoodWriteAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let reported = false;
  const report = (next: boolean): void => {
    if (next === reported) return;
    reported = next;
    onLapseChange?.(next);
  };
  const lapsed = () =>
    lastGoodWriteAt !== null && performance.now() - lastGoodWriteAt > staleAfterMs;
  return {
    lapsed,
    wrote(): void {
      lastGoodWriteAt = performance.now();
      report(false);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => report(lapsed()), staleAfterMs + 1);
      timer.unref?.();
    },
    reset(): void {
      if (timer) clearTimeout(timer);
      timer = null;
      lastGoodWriteAt = null;
      reported = false;
    },
  };
}

/** The refresh must beat the stale bound, and the prune bound must exceed it. */
function assertTimings({
  staleAfterMs,
  refreshEveryMs,
  pruneDeadAfterMs,
}: {
  staleAfterMs: number;
  refreshEveryMs: number;
  pruneDeadAfterMs: number | undefined;
}): void {
  if (!(refreshEveryMs > 0 && refreshEveryMs < staleAfterMs)) {
    throw new RangeError(
      `roster refresh interval (${refreshEveryMs} ms) must be positive and below the stale bound (${staleAfterMs} ms)`,
    );
  }
  if (pruneDeadAfterMs !== undefined && !(pruneDeadAfterMs > staleAfterMs)) {
    throw new RangeError(
      `roster prune bound (${pruneDeadAfterMs} ms) must be above the stale bound (${staleAfterMs} ms)`,
    );
  }
}

/** Plan 2026-10-08 F-10: deletes long-dead entries; a failure is reported, never thrown. */
async function pruneDead({
  ledger,
  pruneDeadAfterMs,
  onPruneError,
}: {
  ledger: ServingRosterLedger;
  pruneDeadAfterMs: number | undefined;
  onPruneError?: (error: unknown) => void;
}): Promise<void> {
  if (pruneDeadAfterMs === undefined || !ledger.pruneRoster) return;
  await ledger.pruneRoster({ deadForMs: pruneDeadAfterMs }).catch((error: unknown) => {
    onPruneError?.(error);
  });
}

/**
 * Which builds are serving, and whether every one declares a step (plan 3.1, D2; ADR-173).
 * `record` writes the row, prunes long-dead ones and refreshes it every `refreshEveryMs` until
 * `stop`. Failed refreshes and prunes are reported; `onLapseChange` hears a lapse (round 9).
 */
export function createServingRoster({
  ledger,
  staleAfterMs,
  refreshEveryMs,
  pruneDeadAfterMs,
  onRefreshError,
  onPruneError,
  onLapseChange,
}: {
  ledger: ServingRosterLedger;
  staleAfterMs: number;
  refreshEveryMs: number;
  /** Absent, nothing is pruned; never below the stale bound, so a live entry is never deleted. */
  pruneDeadAfterMs?: number;
  onRefreshError?: (error: unknown) => void;
  onPruneError?: (error: unknown) => void;
  onLapseChange?: (lapsed: boolean) => void;
}): ServingRoster {
  assertTimings({ staleAfterMs, refreshEveryMs, pruneDeadAfterMs });

  let current: ServingRosterDeclaration | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<unknown> = Promise.resolve();
  const lapse = watchLapse({ staleAfterMs, onLapseChange });

  const clearTimer = (): void => {
    if (timer) clearInterval(timer);
    timer = null;
    lapse.reset();
  };

  const refresh = async (): Promise<void> => {
    if (!current) return;
    const write = ledger.writeRosterEntry(current);
    inFlight = write.catch(() => undefined);
    await write;
    if (current) lapse.wrote();
  };

  const live = (): Promise<ServingRosterEntry[]> => ledger.findLiveRoster({ staleAfterMs });

  return {
    async record(declaration) {
      const parsed = servingRosterDeclarationSchema.parse(declaration);
      clearTimer();
      await ledger.writeRosterEntry(parsed);
      current = parsed;
      lapse.wrote();
      timer = setInterval(() => {
        refresh().catch((error: unknown) => onRefreshError?.(error));
      }, refreshEveryMs);
      timer.unref?.();
      await pruneDead({ ledger, pruneDeadAfterMs, onPruneError });
    },
    refresh,
    async stop() {
      const declared = current;
      current = null;
      clearTimer();
      await inFlight;
      if (!declared) return;
      await ledger.removeRosterEntry({ processId: declared.processId }).catch(() => undefined);
    },
    live,
    async oldWritersGoneFor({ stepId }) {
      const rows = await live();
      return rows.every((row) => row.steps.includes(stepId));
    },
    lapsed: () => current !== null && lapse.lapsed(),
  };
}
