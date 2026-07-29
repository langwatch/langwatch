import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HmrContext, ViteDevServer } from "vite";
import { havenHmrGate } from "./havenHmrGate";

describe("havenHmrGate", () => {
  let dir: string;
  let sentMessages: unknown[];
  let server: ViteDevServer;

  beforeEach(() => {
    vi.useFakeTimers();
    dir = mkdtempSync(path.join(tmpdir(), "haven-hmr-gate-"));
    sentMessages = [];
    server = { ws: { send: (msg: unknown) => sentMessages.push(msg) } } as unknown as ViteDevServer;
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  function fakeCtx(): HmrContext {
    return { modules: ["mod"] } as unknown as HmrContext;
  }

  function build() {
    const plugin = havenHmrGate({ markerPath: path.join(dir, ".haven-hmr-gate") });
    // configureServer + handleHotUpdate are always plain functions on this plugin.
    (plugin.configureServer as (s: ViteDevServer) => void)(server);
    return plugin.handleHotUpdate as (ctx: HmrContext) => unknown;
  }

  describe("given an isolated edit (no recent activity)", () => {
    it("passes the update through immediately, unmodified", () => {
      const handleHotUpdate = build();
      const result = handleHotUpdate(fakeCtx());
      expect(result).toEqual(["mod"]);
      expect(sentMessages).toHaveLength(0);
    });
  });

  describe("when several edits arrive in rapid succession", () => {
    it("swallows the burst and coalesces it into one full-reload after it settles", () => {
      const handleHotUpdate = build();

      // First update: nothing recent before it, so it passes through as isolated.
      expect(handleHotUpdate(fakeCtx())).toEqual(["mod"]);

      // Next four arrive well within the burst-gap window (default 300ms).
      for (let i = 0; i < 4; i++) {
        vi.advanceTimersByTime(50);
        expect(handleHotUpdate(fakeCtx())).toEqual([]);
      }
      expect(sentMessages).toHaveLength(0); // still gated, waiting for the burst to settle

      // Burst goes quiet for longer than burstSettleMs (default 500ms).
      vi.advanceTimersByTime(600);
      expect(sentMessages).toEqual([{ type: "full-reload" }]);
    });
  });

  describe("when an explicit haven hmr on marker is active", () => {
    it("gates even a single isolated update until the marker's TTL lifts", () => {
      const markerPath = path.join(dir, ".haven-hmr-gate");
      writeFileSync(markerPath, String(Date.now() + 1000));

      const plugin = havenHmrGate({ markerPath });
      (plugin.configureServer as (s: ViteDevServer) => void)(server);
      const handleHotUpdate = plugin.handleHotUpdate as (ctx: HmrContext) => unknown;

      expect(handleHotUpdate(fakeCtx())).toEqual([]);
      expect(sentMessages).toHaveLength(0);

      vi.advanceTimersByTime(1300); // past the 1s TTL + the 250ms safety margin
      expect(sentMessages).toEqual([{ type: "full-reload" }]);
    });
  });
});
