import type { AuthzPermission } from "@langwatch/authorization";
import { describe, expect, it } from "vitest";

import {
  anyAuthenticated,
  apiKeyPermission,
  describeAccessPolicy,
  handlerManagedAuth,
  internalSecret,
  policyPermissions,
  publicEndpoint,
  requires,
} from "../access-policy.ts";
import { getRoutePolicy, registerRoutePolicy } from "../route-registry.ts";

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
    /** @scenario "A public or internal route declares a documented reason" */
    it("carries the documented reason", () => {
      expect(publicEndpoint("health probe")).toEqual({
        kind: "public",
        reason: "health probe",
      });
    });

    /** @scenario "A public or internal route declares a documented reason" */
    it("rejects an empty reason so public exposure is always justified", () => {
      expect(() => publicEndpoint("")).toThrow(/non-empty reason/);
      expect(() => publicEndpoint("   ")).toThrow(/non-empty reason/);
    });
  });

  describe("when declaring an internal service endpoint", () => {
    /** @scenario "A public or internal route declares a documented reason" */
    it("carries the documented reason", () => {
      expect(internalSecret("collector OTLP receiver")).toEqual({
        kind: "internal",
        reason: "collector OTLP receiver",
      });
    });

    /** @scenario "A public or internal route declares a documented reason" */
    it("rejects an empty reason", () => {
      expect(() => internalSecret("")).toThrow(/non-empty reason/);
    });
  });

  describe("when a handler manages its own authorization", () => {
    /** @scenario "A public or internal route declares a documented reason" */
    it("carries the documented reason and refuses a blank one", () => {
      const policy = handlerManagedAuth({
        reason: "the signature is the whole gate",
        permissions: [],
        credential: "apiKey",
      });

      expect(policy).toMatchObject({
        kind: "handlerManaged",
        reason: "the signature is the whole gate",
      });

      expect(() =>
        handlerManagedAuth({ reason: "  ", permissions: [], credential: "apiKey" }),
      ).toThrow(/non-empty reason/);
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

describe("the route registry for an API-key-ceiling route", () => {
  /** @scenario "An API-key-ceiling route records its real required permission" */
  it("records the permission the route requires, not any-authenticated", () => {
    registerRoutePolicy({
      method: "get",
      path: "/api/ceiling-probe",
      policy: apiKeyPermission("traces:view"),
      family: "ceiling-probe",
      credentialClass: "project_api_key",
      credential: "api_key",
    });

    const recorded = getRoutePolicy("GET", "/api/ceiling-probe")?.policy;

    expect(recorded).toEqual({ kind: "apiKeyPermission", permission: "traces:view" });
    expect(policyPermissions(recorded!)).toEqual(["traces:view"]);
    expect(describeAccessPolicy(recorded!)).toContain("traces:view");
    expect(describeAccessPolicy(recorded!)).not.toContain("any authenticated");
  });
});
