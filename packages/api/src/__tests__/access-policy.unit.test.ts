import type { AuthzPermission } from "@langwatch/authz-contract";
import { describe, expect, it } from "vitest";

import {
  anyAuthenticated,
  describeAccessPolicy,
  internalSecret,
  publicEndpoint,
  requires,
} from "../access-policy.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;

describe("access policy helpers", () => {
  describe("when a route names a permission the registry does not list", () => {
    /** @scenario "A route policy cannot name a permission outside the registry" */
    it("is refused at the type level: requires() only accepts a registered permission", () => {
      type RequiresParam = Parameters<typeof requires>[0];
      type _RegistryClosed = Assert<Equal<RequiresParam, AuthzPermission>>;
      expect(true satisfies _RegistryClosed).toBe(true);
    });
  });

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
      expect(describeAccessPolicy(requires("prompts:manage"))).toBe("requires prompts:manage");
      expect(describeAccessPolicy(anyAuthenticated())).toBe("any authenticated credential");
      expect(describeAccessPolicy(publicEndpoint("share link"))).toBe("public — share link");
      expect(describeAccessPolicy(internalSecret("cron"))).toBe("internal — cron");
    });
  });
});
