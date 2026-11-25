/**
 * The frame contract and payload caps of connected agents.
 *
 * @see specs/agents/connected-agents.feature
 * @see modules/agent/specs/scenario-hooks-protocol.feature
 */
import { describe, expect, it } from "vitest";

import { relayPayloadCaps } from "../connected-agent.constants.ts";
import {
  CALL_ENVELOPE_KEYS,
  callEnvelopeSchema,
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
    });
  });

  describe("when a hook answers", () => {
    it("accepts a result with a state and no output, and one that carries nothing", () => {
      const bare = { type: "result", protocol: PROTOCOL_VERSION, callId: "call_1" };
      expect(resultFrameSchema.validate({ ...bare, state: { customerId: "c_1" } })).toBe(true);
      expect(resultFrameSchema.validate(bare)).toBe(true);
      expect(resultFrameSchema.validate({ ...bare, state: ["not", "an", "object"] })).toBe(false);
    });
  });

  describe("when an agent registers its hooks", () => {
    it("accepts the declared hooks, and an agent from an older SDK with none", () => {
      const frame = {
        type: "register",
        protocol: PROTOCOL_VERSION,
        sdk: { name: "langwatch", version: "1.0.0", language: "python" },
        instance: {
          id: "inst_1",
          hostname: "laptop",
          username: "dev",
          pid: 1,
          startedAt: "2026-10-16T00:00:00Z",
        },
        agents: [{ name: "shop", environment: "development" }],
      };
      expect(registerFrameSchema.parse(frame).agents[0]?.hooks).toBeUndefined();
      const withHooks = {
        ...frame,
        agents: [{ ...frame.agents[0], hooks: { setup: true, teardown: true } }],
      };
      expect(registerFrameSchema.parse(withHooks).agents[0]?.hooks).toEqual({
        setup: true,
        teardown: true,
      });
    });
  });
});

describe("the call envelope", () => {
  const envelope = {
    callId: "call_1",
    agentId: "agent_1",
    threadId: "thread_1",
    messages: [],
    newMessages: [],
    params: {},
    session: null,
    traceparent: null,
    deadlineAt: 1,
    run: {},
  };

  describe("when the envelope keys are read", () => {
    /** @scenario "The envelope key list includes the new keys" */
    it("includes kind and state", () => {
      expect(CALL_ENVELOPE_KEYS).toContain("kind");
      expect(CALL_ENVELOPE_KEYS).toContain("state");
    });
  });

  describe("when an envelope from an older platform carries no kind", () => {
    /** @scenario "A call with no kind is a turn" */
    it("reads it as a turn", () => {
      expect(callEnvelopeSchema.parse(envelope).kind).toBe("turn");
      expect(callEnvelopeSchema.parse({ ...envelope, kind: "setup" }).kind).toBe("setup");
      expect(callEnvelopeSchema.validate({ ...envelope, kind: "warmup" })).toBe(false);
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
