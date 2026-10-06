import type { UpgradePresence } from "../ledger.ts";
import {
  type PresenceDeclaration,
  type PresenceLedger,
  presenceDeclarationSchema,
} from "./presence-ledger.ts";

export interface Presence {
  record(declaration: PresenceDeclaration): Promise<void>;
  refresh(): Promise<void>;
  stop(): Promise<void>;
  live(): Promise<UpgradePresence[]>;
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

/**
 * Which builds are serving, and whether every one declares a step (plan 3.1, D2; ADR-173).
 * `record` writes the row and refreshes it every `refreshEveryMs` until `stop`; a failed refresh
 * goes to `onRefreshError`. `onLapseChange` hears the last good write pass the stale bound.
 */
export function createPresence({
  ledger,
  staleAfterMs,
  refreshEveryMs,
  onRefreshError,
  onLapseChange,
}: {
  ledger: PresenceLedger;
  staleAfterMs: number;
  refreshEveryMs: number;
  onRefreshError?: (error: unknown) => void;
  onLapseChange?: (lapsed: boolean) => void;
}): Presence {
  if (!(refreshEveryMs > 0 && refreshEveryMs < staleAfterMs)) {
    throw new RangeError(
      `presence refresh interval (${refreshEveryMs} ms) must be positive and below the stale bound (${staleAfterMs} ms)`,
    );
  }

  let current: PresenceDeclaration | null = null;
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
    const write = ledger.writePresence(current);
    inFlight = write.catch(() => undefined);
    await write;
    if (current) lapse.wrote();
  };

  const live = (): Promise<UpgradePresence[]> => ledger.findLivePresence({ staleAfterMs });

  return {
    async record(declaration) {
      const parsed = presenceDeclarationSchema.parse(declaration);
      clearTimer();
      await ledger.writePresence(parsed);
      current = parsed;
      lapse.wrote();
      timer = setInterval(() => {
        refresh().catch((error: unknown) => onRefreshError?.(error));
      }, refreshEveryMs);
      timer.unref?.();
    },
    refresh,
    async stop() {
      const declared = current;
      current = null;
      clearTimer();
      await inFlight;
      if (!declared) return;
      await ledger.removePresence({ processId: declared.processId }).catch(() => undefined);
    },
    live,
    async oldWritersGoneFor({ stepId }) {
      const rows = await live();
      return rows.every((row) => row.steps.includes(stepId));
    },
    lapsed: () => current !== null && lapse.lapsed(),
  };
}
