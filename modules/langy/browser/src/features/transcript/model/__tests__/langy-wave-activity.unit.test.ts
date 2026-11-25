/**
 * The fold moves with LANGY'S BEHAVIOUR, never the cursor — its motion is a quiet status
 * channel, not a spectacle.
 * @vitest-environment node
 * Spec: specs/langy/langy-panel-fold-motion.feature
 */
import { describe, expect, it } from "vitest";

import { deriveWaveActivity } from "../langy-wave-activity.ts";
const assistant = (parts: unknown[]) => ({
  role: "assistant",
  parts: parts as never,
});
const user = { role: "user", parts: [{ type: "text", text: "hi" }] };

const derive = (overrides: Partial<Parameters<typeof deriveWaveActivity>[0]> = {}) =>
  deriveWaveActivity({
    turnInFlight: false,
    isSettling: false,
    hasLiveReasoning: false,
    messages: [user],
    ...overrides,
  });

describe("deriveWaveActivity", () => {
  describe("given no turn in flight", () => {
    it("rests idle", () => {
      expect(derive()).toBe("idle");
    });
  });

  describe("given a turn in flight", () => {
    describe("when nothing has reached the wire", () => {
      it("waits — it never claims work that isn't happening", () => {
        expect(derive({ turnInFlight: true, messages: [user, assistant([])] })).toBe("waiting");
      });
    });

    describe("when reasoning is streaming", () => {
      it("thinks", () => {
        expect(
          derive({
            turnInFlight: true,
            hasLiveReasoning: true,
            messages: [user, assistant([])],
          }),
        ).toBe("thinking");
      });
    });

    describe("when tokens are arriving", () => {
      it("streams", () => {
        expect(
          derive({
            turnInFlight: true,
            messages: [user, assistant([{ type: "text", text: "Here's" }])],
          }),
        ).toBe("streaming");
      });

      it("prefers streaming over thinking once prose lands", () => {
        expect(
          derive({
            turnInFlight: true,
            hasLiveReasoning: true,
            messages: [user, assistant([{ type: "text", text: "Here's" }])],
          }),
        ).toBe("streaming");
      });
    });

    describe("when a tool is running", () => {
      const runningToolPart = {
        type: "tool-bash",
        state: "input-available",
        input: { command: "ls" },
      };

      it("pulses on the tool, even mid-prose", () => {
        expect(
          derive({
            turnInFlight: true,
            messages: [user, assistant([{ type: "text", text: "Let me check" }, runningToolPart])],
          }),
        ).toBe("tool");
      });

      it("returns to streaming once the tool settles", () => {
        expect(
          derive({
            turnInFlight: true,
            messages: [
              user,
              assistant([
                { type: "text", text: "Let me check" },
                { ...runningToolPart, state: "output-available" },
              ]),
            ],
          }),
        ).toBe("streaming");
      });
    });
  });

  describe("given a failed or recovering turn", () => {
    it("settles, whatever else is on the wire", () => {
      expect(
        derive({
          turnInFlight: true,
          isSettling: true,
          messages: [user, assistant([{ type: "text", text: "partial" }])],
        }),
      ).toBe("settling");
    });
  });
});
