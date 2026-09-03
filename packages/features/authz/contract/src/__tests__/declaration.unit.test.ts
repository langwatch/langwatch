import { describe, expect, it } from "vitest";
import {
  declaredScopeId,
  isPlatformTierPermission,
  permissionGrantTiers,
  resolveDeclaredScope,
} from "../declaration";

describe("permissionGrantTiers", () => {
  describe("given a project-grantable permission", () => {
    it("lists the tiers most specific first", () => {
      expect(permissionGrantTiers("traces:view")).toEqual(["project", "team", "organization"]);
    });
  });

  describe("given an organization-only permission", () => {
    it("lists only the organization tier", () => {
      expect(permissionGrantTiers("governance:view")).toEqual(["organization"]);
      expect(permissionGrantTiers("organization:manage")).toEqual(["organization"]);
    });
  });

  describe("given a platform-tier permission", () => {
    it("lists no input-addressable tier", () => {
      expect(permissionGrantTiers("ops:view")).toEqual([]);
      expect(isPlatformTierPermission("ops:view")).toBe(true);
      expect(isPlatformTierPermission("traces:view")).toBe(false);
    });
  });
});

describe("declaredScopeId", () => {
  describe("when the input carries ids at several allowed tiers", () => {
    it("resolves the most specific tier the permission allows", () => {
      expect(
        declaredScopeId({
          permission: "traces:view",
          input: { projectId: "proj_1", organizationId: "org_1" },
        }),
      ).toEqual({ tier: "project", id: "proj_1" });
    });
  });

  describe("when the permission is organization-only and the input carries a projectId too", () => {
    it("ignores the tier the permission cannot be granted at", () => {
      expect(
        declaredScopeId({
          permission: "organization:manage",
          input: { projectId: "proj_1", organizationId: "org_1" },
        }),
      ).toEqual({ tier: "organization", id: "org_1" });
    });
  });

  describe("when a via field is declared", () => {
    it("resolves the named field at its own tier", () => {
      expect(
        declaredScopeId({
          permission: "organization:manage",
          input: { teamId: "team_1" },
          via: "teamId",
        }),
      ).toEqual({ tier: "team", id: "team_1" });
    });

    it("returns null when the named field is absent or empty", () => {
      expect(
        declaredScopeId({
          permission: "organization:manage",
          input: { teamId: "" },
          via: "teamId",
        }),
      ).toBeNull();
      expect(
        declaredScopeId({
          permission: "organization:manage",
          input: {},
          via: "teamId",
        }),
      ).toBeNull();
    });
  });

  describe("when the input carries no id the permission can use", () => {
    it("returns null so the caller treats it as a wiring bug", () => {
      expect(declaredScopeId({ permission: "governance:view", input: {} })).toBeNull();
      expect(
        declaredScopeId({
          permission: "governance:view",
          input: { projectId: "proj_1" },
        }),
      ).toBeNull();
    });

    it("never reads a non-string id", () => {
      expect(
        declaredScopeId({
          permission: "traces:view",
          input: { projectId: 42 as unknown as string },
        }),
      ).toBeNull();
    });
  });
});

describe("resolveDeclaredScope", () => {
  describe("when the input names the scope field but leaves it empty", () => {
    /** @scenario "A scope id the caller left blank is answered as invalid input" */
    it("reports the blank field rather than a missing declaration", () => {
      expect(
        resolveDeclaredScope({
          permission: "traces:view",
          input: { projectId: "" },
        }),
      ).toEqual({
        resolved: false,
        unresolved: { reason: "blank", field: "projectId" },
      });
    });

    /** @scenario "A blank scope id never shadows one the caller did fill in" */
    it("keeps walking to a wider tier the caller did fill in", () => {
      expect(
        resolveDeclaredScope({
          permission: "traces:view",
          input: { projectId: "", organizationId: "org_1" },
        }),
      ).toEqual({
        resolved: true,
        scope: { tier: "organization", id: "org_1" },
      });
    });

    /** @scenario "A scope id the caller left blank is answered as invalid input" */
    it("names the blank via field when the declaration derives its scope", () => {
      expect(
        resolveDeclaredScope({
          permission: "organization:manage",
          input: { teamId: "" },
          via: "teamId",
        }),
      ).toEqual({
        resolved: false,
        unresolved: { reason: "blank", field: "teamId" },
      });
    });
  });

  describe("when the input names the scope field with a value that is not a string", () => {
    /**
     * Only reachable past a bypassed type layer — every declaration parses its
     * input before this runs, so a wrong-typed id is already a 400 by here.
     * Pinned because the tempting "fix" is to call it `absent`, which would
     * page an engineer for a caller's malformed request: the caller named the
     * field, so the mistake is theirs to correct whatever they put in it.
     */
    it("answers the caller rather than reporting a wiring bug", () => {
      expect(
        resolveDeclaredScope({
          permission: "traces:view",
          input: { projectId: 42 as unknown as string },
        }),
      ).toEqual({
        resolved: false,
        unresolved: { reason: "blank", field: "projectId" },
      });
      expect(
        resolveDeclaredScope({
          permission: "traces:view",
          input: { projectId: undefined },
        }),
      ).toEqual({
        resolved: false,
        unresolved: { reason: "blank", field: "projectId" },
      });
    });

    it("still walks past it to a wider tier the caller did fill in", () => {
      expect(
        resolveDeclaredScope({
          permission: "traces:view",
          input: {
            projectId: 42 as unknown as string,
            organizationId: "org_1",
          },
        }),
      ).toEqual({
        resolved: true,
        scope: { tier: "organization", id: "org_1" },
      });
    });
  });

  describe("when the input names no scope field the permission can use", () => {
    /** @scenario "An input carrying no scope id at all is still a wiring bug" */
    it("reports the declaration as miswired, not the caller as wrong", () => {
      expect(resolveDeclaredScope({ permission: "traces:view", input: {} })).toEqual({
        resolved: false,
        unresolved: { reason: "absent" },
      });
    });

    /**
     * The input itself is not an object. `namesField` was written to survive
     * exactly this, but the resolution walk read a field off the input BEFORE
     * reaching it, so `null` threw where it should have answered. Which is
     * this change's own lesson said twice: the signature says
     * `Partial<Record<...>>`, and the signature is not what arrives.
     *
     * @scenario "An input carrying no scope id at all is still a wiring bug"
     */
    it.each([
      ["null", null],
      ["undefined", undefined],
      ["a primitive", 42],
      ["a string", "org_1"],
    ])("answers absent rather than throwing when the input is %s", (_label, input) => {
      expect(
        resolveDeclaredScope({
          permission: "traces:view",
          // The bypassed type layer this path exists to survive.
          input: input as never,
        }),
      ).toEqual({ resolved: false, unresolved: { reason: "absent" } });
    });

    /**
     * A tier the permission cannot be granted at is not a field the caller
     * was asked to fill, so filling it badly is still our wiring, not theirs.
     *
     * @scenario "An input carrying no scope id at all is still a wiring bug"
     */
    it("ignores a blank id at a tier the permission cannot be granted at", () => {
      expect(
        resolveDeclaredScope({
          permission: "governance:view",
          input: { projectId: "" },
        }),
      ).toEqual({ resolved: false, unresolved: { reason: "absent" } });
    });
  });
});
