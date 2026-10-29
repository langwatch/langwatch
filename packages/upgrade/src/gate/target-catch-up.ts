import { isPrivateTarget } from "../runner/schema-applier.ts";
import type { FirstInstallUpgrade } from "./first-install-upgrade.ts";
import { UPGRADE_COMMAND } from "./serving-gate.ts";

/** How often an admitted worker looks for a held ClickHouse target (Alex, 2026-10-11, T7-F1). */
export const TARGET_CATCH_UP_EVERY_MS = 60_000;

type CatchUpWarn = (message: string, fields: Record<string, unknown>) => void;

/**
 * The private targets a pass should catch up: those the ledger records behind, plus every
 * configured one with no rows at all, which the runner's preflight seeds behind on that pass.
 */
export function privateTargetsBehind({
  behind,
  recorded,
  configured,
}: {
  behind: readonly string[];
  recorded: readonly string[];
  configured: readonly string[];
}): string[] {
  const known = new Set(recorded);
  const unrecorded = configured.filter((target) => !known.has(target));
  return [...new Set([...behind, ...unrecorded].filter((target) => isPrivateTarget({ target })))];
}

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
  shareTargetsBehind,
  everyMs = TARGET_CATCH_UP_EVERY_MS,
  maxMs,
}: {
  findTargetsBehind: () => Promise<readonly string[]>;
  findLeaseHolder: () => Promise<unknown>;
  upgrade: FirstInstallUpgrade;
  warn: CatchUpWarn;
  /** Tells every instance which targets are behind, so their reads answer upgrade_in_progress. */
  shareTargetsBehind?: (targets: readonly string[]) => Promise<void>;
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
  const share = (targets: readonly string[]) => shareSafely({ shareTargetsBehind, warn, targets });
  const once = async () => {
    try {
      waitMs = await catchUpPass({
        findTargetsBehind,
        findLeaseHolder,
        upgrade,
        warn,
        share,
        stopped: () => stopped,
        waits: { waitMs, everyMs, maxMs },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warn("ClickHouse target catch-up pass failed", { phase: "catch-up", error: message });
    }
    schedule();
  };
  if (shareTargetsBehind) void findTargetsBehind().then(share, () => undefined);
  schedule();
  return {
    // A running upgrade holds its own lease and finishes on its own; a stop does not wait for it.
    stop: async () => {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

/** A failed share only warns: the targets still catch up, and readers fall back to the 500. */
async function shareSafely({
  shareTargetsBehind,
  warn,
  targets,
}: {
  shareTargetsBehind: ((targets: readonly string[]) => Promise<void>) | undefined;
  warn: CatchUpWarn;
  targets: readonly string[];
}): Promise<void> {
  try {
    await shareTargetsBehind?.(targets);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn("could not share the ClickHouse targets catching up", {
      phase: "catch-up",
      error: message,
    });
  }
}

/** One pass: shares the targets behind and upgrades if no run holds the lease; the next wait. */
async function catchUpPass({
  findTargetsBehind,
  findLeaseHolder,
  upgrade,
  warn,
  share,
  stopped,
  waits: { waitMs, everyMs, maxMs },
}: {
  findTargetsBehind: () => Promise<readonly string[]>;
  findLeaseHolder: () => Promise<unknown>;
  upgrade: FirstInstallUpgrade;
  warn: CatchUpWarn;
  share: (targets: readonly string[]) => Promise<void>;
  stopped: () => boolean;
  waits: { waitMs: number; everyMs: number; maxMs: number };
}): Promise<number> {
  const behind = await findTargetsBehind();
  await share(behind);
  if (behind.length === 0) return everyMs;
  if ((await findLeaseHolder()) !== null || stopped()) return waitMs;
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
  await share(still);
  return still.length === 0 ? everyMs : Math.min(waitMs * 2, maxMs);
}
