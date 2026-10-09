import { describe, expect, it } from "vitest";
import { DeliveredCalls } from "../delivered-calls";
import {
  LOCAL_CONTROL_PROTOCOL_VERSION,
  type PlatformFrame,
} from "../protocol";

function callFrame(callId: string): PlatformFrame {
  return {
    type: "call",
    protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
    call: {
      callId,
      conversationId: "langyconv_1",
      turnId: "turn_1",
      deadlineAt: 1_800_000_000_000,
      tool: "local_bash",
      params: { command: "uv run pytest" },
    },
  };
}

describe("DeliveredCalls", () => {
  describe("given a call that reaches the connection twice", () => {
    /** @scenario "A call written while the folder registers is handed over once" */
    it("admits the first copy and refuses the second", () => {
      const delivered = new DeliveredCalls();

      expect(delivered.admit(callFrame("lcall_1"))).toBe(true);
      expect(delivered.admit(callFrame("lcall_1"))).toBe(false);
      expect(delivered.admit(callFrame("lcall_2"))).toBe(true);
    });
  });

  describe("given a call whose result arrived", () => {
    it("admits the same id again, the set holds only calls in flight", () => {
      const delivered = new DeliveredCalls();
      delivered.admit(callFrame("lcall_1"));
      delivered.settle("lcall_1");

      expect(delivered.admit(callFrame("lcall_1"))).toBe(true);
    });
  });

  describe("given frames that are not calls", () => {
    it("admits every one of them", () => {
      const delivered = new DeliveredCalls();
      const disconnect: PlatformFrame = {
        type: "disconnect",
        protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
        reason: "user",
      };

      expect(delivered.admit(disconnect)).toBe(true);
      expect(delivered.admit(disconnect)).toBe(true);
    });
  });
});
