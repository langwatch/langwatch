import { existsSync, readFileSync } from "fs";
import path from "path";
import type { Plugin, ViteDevServer } from "vite";

/**
 * AI-gated HMR.
 *
 * When an AI agent is making many rapid edits, firing Vite HMR on every save
 * thrashes a human's open browser through broken intermediate states. This plugin
 * reads a marker written by `haven hmr on` (an expiry timestamp in ms): while the
 * gate is live, HMR updates are deferred; once it lifts (the marker is cleared or
 * its TTL passes) the plugin fires a single full-reload so the browser jumps
 * straight to the final state.
 *
 * It is opt-in (no marker → normal HMR) and can never permanently block reloads:
 * the gate is always time-bounded by the marker's own expiry, and a safety timer
 * fires the catch-up reload even if nothing ever clears the marker.
 */
export function havenHmrGate(markerPath?: string): Plugin {
  const marker = markerPath ?? path.resolve(process.cwd(), ".haven-hmr-gate");
  const MAX_GATE_MS = 60_000; // never hold longer than this, whatever the marker says
  let server: ViteDevServer | undefined;
  let owedReload = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

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
    owedReload = false;
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    server?.ws.send({ type: "full-reload" });
  }

  return {
    name: "haven-hmr-gate",
    apply: "serve",
    configureServer(s) {
      server = s;
    },
    handleHotUpdate(ctx) {
      const now = Date.now();
      const remaining = gateExpiry() - now;
      if (remaining > 0) {
        // Gated: swallow this HMR update, remember we owe the browser a reload,
        // and schedule the catch-up for when the gate is due to lift.
        owedReload = true;
        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, Math.min(remaining, MAX_GATE_MS) + 250);
        return [];
      }
      // Not gated: if we deferred updates earlier, reload once to catch up.
      if (owedReload) flush();
      return ctx.modules;
    },
  };
}
