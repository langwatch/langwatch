/**
 * The frame contract and payload caps of connected agents.
 *
 * @see specs/agents/connected-agents.feature
 */
import { describe, expect, it } from "vitest";
import { relayPayloadCaps } from "../connected-agent.constants";
import {
  PROTOCOL_VERSION,
  registerFrameSchema,
  resultFrameSchema,
} from "../connected-agent.protocol";

describe("the frame contract", () => {
  describe("when a frame carries no protocol version", () => {
    /** @scenario "Every frame carries the protocol version" */
    it("refuses the frame", () => {
      const frame = {
        type: "register",
        sdk: { name: "langwatch", version: "1.0.0", language: "python" },
        instance: {
          id: "inst_1",
          hostname: "laptop",
          username: "dev",
          pid: 1,
          startedAt: "2026-08-30T00:00:00Z",
        },
        agents: [{ name: "support-agent", environment: "development" }],
      };
      expect(registerFrameSchema.safeParse(frame).success).toBe(false);
      expect(registerFrameSchema.safeParse({ ...frame, protocol: PROTOCOL_VERSION }).success).toBe(
        true,
      );
    });
  });

  describe("when a result carries both an output and an error", () => {
    /** @scenario "A result frame carries either an output or an error" */
    it("refuses the frame", () => {
      const both = {
        type: "result",
        protocol: PROTOCOL_VERSION,
        callId: "call_1",
        output: "hello",
        error: { code: "boom", message: "it broke" },
      };
      expect(resultFrameSchema.safeParse(both).success).toBe(false);
      expect(resultFrameSchema.safeParse({ ...both, error: undefined }).success).toBe(true);
      expect(resultFrameSchema.safeParse({ ...both, output: undefined }).success).toBe(true);
      expect(
        resultFrameSchema.safeParse({
          type: "result",
          protocol: PROTOCOL_VERSION,
          callId: "call_1",
        }).success,
      ).toBe(false);
    });
  });
});

describe("the payload caps", () => {
  describe("when the self-hosted override is set", () => {
    /** @scenario "The relay payload cap can be raised on a self-hosted deployment" */
    it("raises the envelope cap and keeps the frame cap above it", () => {
      const caps = relayPayloadCaps(128);
      expect(caps.envelopeBytes).toBe(128 * 1024 * 1024);
      expect(caps.frameBytes).toBeGreaterThanOrEqual(caps.envelopeBytes);
      expect(caps.resultBytes).toBeLessThan(caps.envelopeBytes);
      expect(relayPayloadCaps(undefined).envelopeBytes).toBe(32 * 1024 * 1024);
      expect(relayPayloadCaps(-1).envelopeBytes).toBe(32 * 1024 * 1024);
    });
  });
});
