import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createHmrGate, type HmrReloadChannel } from "../havenHmrGate";

describe("havenHmrGate", () => {
  let dir: string;
  let sentMessages: unknown[];
  let server: HmrReloadChannel;

  beforeEach(() => {
    vi.useFakeTimers();
    dir = mkdtempSync(path.join(tmpdir(), "haven-hmr-gate-"));
    sentMessages = [];
    server = {
      ws: {
        send: (msg) => {
          sentMessages.push(msg);
        },
      },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  function fakeCtx(): string[] {
    return ["mod"];
  }

  function build() {
    const gate = createHmrGate({
      markerPath: path.join(dir, ".haven-hmr-gate"),
    });
    gate.attach(server);
    return (modules: string[]) => gate.hotUpdate(modules);
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

      const gate = createHmrGate({ markerPath });
      gate.attach(server);
      const handleHotUpdate = (modules: string[]) => gate.hotUpdate(modules);

      expect(handleHotUpdate(fakeCtx())).toEqual([]);
      expect(sentMessages).toHaveLength(0);

      vi.advanceTimersByTime(1300); // past the 1s TTL + the 250ms safety margin
      expect(sentMessages).toEqual([{ type: "full-reload" }]);
    });
  });
});
