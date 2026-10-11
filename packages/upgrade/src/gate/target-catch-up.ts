import type { FirstInstallUpgrade } from "./first-install-upgrade.ts";
import { UPGRADE_COMMAND } from "./serving-gate.ts";

/** How often an admitted worker looks for a held ClickHouse target (Alex, 2026-10-11, T7-F1). */
export const TARGET_CATCH_UP_EVERY_MS = 60_000;

type CatchUpWarn = (message: string, fields: Record<string, unknown>) => void;

/**
 * While a held private ClickHouse target is behind and no run holds the lease, an admitted worker
 * runs the upgrade, which catches it up; each pass it stays behind waits twice as long, to `maxMs`.
 * Spec: specs/upgrade/serving-gate.feature.
 */
export function startTargetCatchUp({
  findTargetsBehind,
  findLeaseHolder,
  upgrade,
  warn,
  everyMs = TARGET_CATCH_UP_EVERY_MS,
  maxMs,
}: {
  findTargetsBehind: () => Promise<readonly string[]>;
  findLeaseHolder: () => Promise<unknown>;
  upgrade: FirstInstallUpgrade;
  warn: CatchUpWarn;
  everyMs?: number;
  maxMs: number;
}): { stop: () => Promise<void> } {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waitMs = everyMs;
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => void once(), waitMs);
    timer.unref?.();
  };
  const once = async () => {
    try {
      const behind = await findTargetsBehind();
      if (behind.length === 0) waitMs = everyMs;
      else if ((await findLeaseHolder()) === null && !stopped) {
        warn(
          `ClickHouse target ${behind.join(", ")} is behind; this worker runs the upgrade to catch it up`,
          {
            phase: "catch-up",
            targets: behind,
            waitingOn: `\`${UPGRADE_COMMAND}\``,
            next: "nothing to do: the target catches up once it answers",
          },
        );
        await upgrade();
        const still = await findTargetsBehind();
        waitMs = still.length === 0 ? everyMs : Math.min(waitMs * 2, maxMs);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warn("ClickHouse target catch-up pass failed", { phase: "catch-up", error: message });
    }
    schedule();
  };
  schedule();
  return {
    // A running upgrade holds its own lease and finishes on its own; a stop does not wait for it.
    stop: async () => {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
