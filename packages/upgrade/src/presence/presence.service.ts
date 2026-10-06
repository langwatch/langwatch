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
}

/**
 * Which builds are serving, and whether every one declares a step (plan 3.1, D2; ADR-173).
 * `record` writes the row and refreshes it every `refreshEveryMs` until `stop`; a refresh
 * that fails goes to `onRefreshError` and the next interval tries again.
 */
export function createPresence({
  ledger,
  staleAfterMs,
  refreshEveryMs,
  onRefreshError,
}: {
  ledger: PresenceLedger;
  staleAfterMs: number;
  refreshEveryMs: number;
  onRefreshError?: (error: unknown) => void;
}): Presence {
  if (!(refreshEveryMs > 0 && refreshEveryMs < staleAfterMs)) {
    throw new RangeError(
      `presence refresh interval (${refreshEveryMs} ms) must be positive and below the stale bound (${staleAfterMs} ms)`,
    );
  }

  let current: PresenceDeclaration | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<unknown> = Promise.resolve();

  const clearTimer = (): void => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  const refresh = async (): Promise<void> => {
    if (!current) return;
    const write = ledger.writePresence(current);
    inFlight = write.catch(() => undefined);
    await write;
  };

  const live = (): Promise<UpgradePresence[]> => ledger.findLivePresence({ staleAfterMs });

  return {
    async record(declaration) {
      const parsed = presenceDeclarationSchema.parse(declaration);
      clearTimer();
      await ledger.writePresence(parsed);
      current = parsed;
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
  };
}
