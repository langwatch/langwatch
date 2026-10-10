/**
 * The frame contract and payload caps of connected agents.
 *
 * @see specs/agents/connected-agents.feature
 */
import { describe, expect, it } from "vitest";

import { relayPayloadCaps } from "../connected-agent.constants.ts";
import {
  PROTOCOL_VERSION,
  registerFrameSchema,
  resultFrameSchema,
} from "../connected-agent.protocol.ts";

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
      expect(registerFrameSchema.validate(frame)).toBe(false);
      expect(registerFrameSchema.validate({ ...frame, protocol: PROTOCOL_VERSION })).toBe(true);
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
      expect(resultFrameSchema.validate(both)).toBe(false);
      expect(resultFrameSchema.validate({ ...both, error: undefined })).toBe(true);
      expect(resultFrameSchema.validate({ ...both, output: undefined })).toBe(true);
      expect(
        resultFrameSchema.validate({
          type: "result",
          protocol: PROTOCOL_VERSION,
          callId: "call_1",
        }),
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
