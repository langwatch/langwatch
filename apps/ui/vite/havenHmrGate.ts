import { existsSync, readFileSync } from "fs";
import path from "path";

import type { Plugin } from "vite";

/** The one Vite server surface the gate touches: the reload it sends. */
export type HmrReloadChannel = { ws: { send(payload: { type: "full-reload" }): void } };

function releaseIsolatedUpdate<Module>({
  isReloadOwed,
  flush,
  modules,
}: {
  isReloadOwed: boolean;
  flush: () => void;
  modules: Module[];
}): Module[] {
  if (isReloadOwed) flush();

  return modules;
}

type HmrGateOptions = { markerPath?: string; burstGapMs?: number; burstSettleMs?: number };

/**
 * Auto-gated HMR: coalesces a rapid burst of saves (an AI agent editing)
 * into one trailing full-reload, instead of thrashing a human's browser
 * through every intermediate state. `haven hmr on|off` still overrides it.
 */
export function havenHmrGate(options?: HmrGateOptions): Plugin {
  const gate = createHmrGate(options);

  return {
    name: "haven-hmr-gate",
    apply: "serve",
    configureServer(server) {
      gate.attach(server);
    },
    handleHotUpdate(ctx) {
      return gate.hotUpdate(ctx.modules);
    },
  };
}

/** The gate over the two surfaces it touches, which {@link havenHmrGate} plugs into Vite. */
export function createHmrGate(options?: HmrGateOptions): {
  attach(server: HmrReloadChannel): void;
  hotUpdate<Module>(modules: Module[]): Module[];
} {
  const marker = options?.markerPath ?? path.resolve(process.cwd(), ".haven-hmr-gate");
  const BURST_GAP_MS = options?.burstGapMs ?? 300; // updates closer together than this = one burst
  const BURST_SETTLE_MS = options?.burstSettleMs ?? 500; // delay before coalesced reload
  const MAX_GATE_MS = 60_000; // never hold longer than this, whatever the marker says
  let server: HmrReloadChannel | undefined;
  let isReloadOwed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastUpdateAt = 0;

  function gateExpiry(): number {
    try {
      if (!existsSync(marker)) return 0;
      const exp = Number(readFileSync(marker, "utf8").trim());
      return Number.isFinite(exp) ? exp : 0;
    } catch {
      return 0; // never let the gate break the dev server
    }
  }

  function flush(): void {
    isReloadOwed = false;
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    server?.ws.send({ type: "full-reload" });
  }

  function scheduleFlush(delayMs: number): void {
    isReloadOwed = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, delayMs);
  }

  return {
    attach(s) {
      server = s;
    },
    hotUpdate(modules) {
      const now = Date.now();

      // Explicit override (haven hmr on) wins when active, regardless of cadence.
      const markerRemaining = gateExpiry() - now;
      if (markerRemaining > 0) {
        scheduleFlush(Math.min(markerRemaining, MAX_GATE_MS) + 250);
        lastUpdateAt = now;
        return [];
      }

      const sinceLast = now - lastUpdateAt;
      lastUpdateAt = now;

      if (sinceLast > BURST_GAP_MS) {
        // Isolated update, not part of a rapid burst — let it straight through.
        // (If a burst's trailing timer somehow hadn't fired yet, catch up first.)
        return releaseIsolatedUpdate({ isReloadOwed, flush, modules });
      }

      // Part of a rapid burst: swallow, and coalesce into one trailing reload
      // once the burst goes quiet.
      scheduleFlush(BURST_SETTLE_MS);
      return [];
    },
  };
}
