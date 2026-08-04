import { describe, expect, it } from "vitest";

import {
  anyAuthenticated,
  describeAccessPolicy,
  internalSecret,
  publicEndpoint,
  requires,
} from "../access-policy";

describe("access policy helpers", () => {
  describe("when requiring a permission", () => {
    it("carries the permission on a permission-kind policy", () => {
      expect(requires("traces:view")).toEqual({
        kind: "permission",
        permission: "traces:view",
      });
    });
  });

  describe("when allowing any authenticated caller", () => {
    it("produces an anyAuthenticated-kind policy", () => {
      expect(anyAuthenticated()).toEqual({ kind: "anyAuthenticated" });
    });
  });

  describe("when declaring a public endpoint", () => {
    it("carries the documented reason", () => {
      expect(publicEndpoint("health probe")).toEqual({
        kind: "public",
        reason: "health probe",
      });
    });

    it("rejects an empty reason so public exposure is always justified", () => {
      expect(() => publicEndpoint("")).toThrow(/non-empty reason/);
      expect(() => publicEndpoint("   ")).toThrow(/non-empty reason/);
    });
  });

  describe("when declaring an internal service endpoint", () => {
    it("carries the documented reason", () => {
      expect(internalSecret("collector OTLP receiver")).toEqual({
        kind: "internal",
        reason: "collector OTLP receiver",
      });
    });

    it("rejects an empty reason", () => {
      expect(() => internalSecret("")).toThrow(/non-empty reason/);
    });
  });

  describe("when describing a policy for the registry", () => {
    it("summarizes each kind", () => {
      expect(describeAccessPolicy(requires("prompts:manage"))).toBe(
        "requires prompts:manage",
      );
      expect(describeAccessPolicy(anyAuthenticated())).toBe(
        "any authenticated credential",
      );
      expect(describeAccessPolicy(publicEndpoint("share link"))).toBe(
        "public — share link",
      );
      expect(describeAccessPolicy(internalSecret("cron"))).toBe(
        "internal — cron",
      );
    });
  });
});
