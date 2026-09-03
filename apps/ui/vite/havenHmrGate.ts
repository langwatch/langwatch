import { existsSync, readFileSync } from "fs";
import path from "path";
import type { Plugin, ViteDevServer } from "vite";

/**
 * Auto-gated HMR: coalesces a rapid burst of saves (an AI agent editing)
 * into one trailing full-reload, instead of thrashing a human's browser
 * through every intermediate state. `haven hmr on|off` still overrides it.
 */
export function havenHmrGate(options?: {
  markerPath?: string;
  burstGapMs?: number;
  burstSettleMs?: number;
}): Plugin {
  const marker = options?.markerPath ?? path.resolve(process.cwd(), ".haven-hmr-gate");
  const BURST_GAP_MS = options?.burstGapMs ?? 300; // updates closer together than this = one burst
  const BURST_SETTLE_MS = options?.burstSettleMs ?? 500; // quiet time before the coalesced reload fires
  const MAX_GATE_MS = 60_000; // never hold longer than this, whatever the marker says
  let server: ViteDevServer | undefined;
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
    name: "haven-hmr-gate",
    apply: "serve",
    configureServer(s) {
      server = s;
    },
    handleHotUpdate(ctx) {
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
        if (isReloadOwed) flush();
        return ctx.modules;
      }

      // Part of a rapid burst: swallow, and coalesce into one trailing reload
      // once the burst goes quiet.
      scheduleFlush(BURST_SETTLE_MS);
      return [];
    },
  };
}
