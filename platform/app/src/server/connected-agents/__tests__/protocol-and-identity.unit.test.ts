/**
 * The frame contract and the identity rules of connected agents.
 *
 * @see specs/agents/connected-agents.feature
 */
import { describe, expect, it } from "vitest";
import { relayPayloadCaps } from "../constants";
import {
  deriveScope,
  identityKeyOf,
  parseConnectedReference,
  sanitizeEnvironment,
  sanitizeHostLabel,
} from "../identity";
import {
  PROTOCOL_VERSION,
  registerFrameSchema,
  resultFrameSchema,
} from "../protocol";

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
      expect(
        registerFrameSchema.safeParse({ ...frame, protocol: PROTOCOL_VERSION })
          .success,
      ).toBe(true);
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
      expect(
        resultFrameSchema.safeParse({ ...both, error: undefined }).success,
      ).toBe(true);
      expect(
        resultFrameSchema.safeParse({ ...both, output: undefined }).success,
      ).toBe(true);
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

describe("identity", () => {
  describe("when an environment holds characters outside the grammar", () => {
    /** @scenario "The environment is sanitized before it becomes part of the identity" */
    it("lowercases, replaces runs of other characters and cuts to 32", () => {
      expect(sanitizeEnvironment("Prod-EU 1")).toBe("prod-eu-1");
      expect(sanitizeEnvironment("  Staging  ")).toBe("staging");
      expect(sanitizeEnvironment("a".repeat(40))).toHaveLength(32);
      expect(sanitizeEnvironment("dev_shared")).toBe("dev_shared");
    });
  });

  describe("when a personal key registers a development agent", () => {
    /** @scenario "A development agent registered with a personal key belongs to its owner" */
    it("scopes the identity to the owner", () => {
      const scope = deriveScope({
        environment: "development",
        userId: "u_1",
        hostname: "laptop",
      });
      expect(scope).toEqual({ kind: "owner", userId: "u_1" });
      expect(
        identityKeyOf({
          name: "support-agent",
          environment: "development",
          scope,
        }),
      ).toBe("support-agent@development/user:u_1");
    });
  });

  describe("when a project key registers a development agent", () => {
    /** @scenario "A development agent registered with a project key is scoped to its host" */
    it("scopes the identity to the sanitized host", () => {
      const scope = deriveScope({
        environment: "development",
        userId: null,
        hostname: "Rogerio's MacBook",
      });
      expect(scope).toEqual({ kind: "host", hostLabel: "rogerio-s-macbook" });
      expect(
        identityKeyOf({
          name: "support-agent",
          environment: "development",
          scope,
        }),
      ).toBe("support-agent@development/host:rogerio-s-macbook");
      expect(sanitizeHostLabel("")).toBe("unknown-host");
    });
  });

  describe("when any other environment is registered", () => {
    /** @scenario "An agent in any other environment is shared" */
    it("takes no scope", () => {
      const scope = deriveScope({
        environment: "production",
        userId: "u_1",
        hostname: "laptop",
      });
      expect(scope).toEqual({ kind: "shared" });
      expect(
        identityKeyOf({
          name: "support-agent",
          environment: "production",
          scope,
        }),
      ).toBe("support-agent@production");
    });
  });

  describe("when a target reference names an agent by name and environment", () => {
    it("splits it at the first @", () => {
      expect(parseConnectedReference("support-agent@production")).toEqual({
        name: "support-agent",
        environment: "production",
      });
      expect(parseConnectedReference("agent_abc123")).toBeNull();
      expect(parseConnectedReference("@production")).toBeNull();
      expect(parseConnectedReference("support-agent@")).toBeNull();
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
