/**
 * The identity rules of connected agents.
 *
 * @see specs/agents/connected-agents.feature
 */
import { describe, expect, it } from "vitest";
import {
  deriveScope,
  identityKeyOf,
  parseConnectedReference,
  sanitizeEnvironment,
  sanitizeHostLabel,
} from "../connected-agent.identity";

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
