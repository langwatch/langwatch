import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createHmrGate, type HmrReloadChannel } from "../havenHmrGate";

describe("havenHmrGate", () => {
  let sentMessages: unknown[];
  let server: HmrReloadChannel;

  beforeEach(() => {
    vi.useFakeTimers();
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
  });

  function fakeCtx(): string[] {
    return ["mod"];
  }

  function build() {
    const gate = createHmrGate();
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
});
