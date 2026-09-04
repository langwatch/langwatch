import { describe, expect, it } from "vitest";
import {
  declaredScopeId,
  isPlatformTierPermission,
  permissionGrantTiers,
  resolveDeclaredScope,
  type DeclarationError,
  type PermissionScopeArg,
  type ValidatePermissionForInput,
} from "../declaration";

/** Type-level assertion helper, mirroring packages/api/type-tests. */
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;

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
    /** @scenario "The most specific tier the permission allows decides the check scope" */
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
    /** @scenario "A scope derivation is written at the call site, never inferred" */
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

/**
 * The compile-time half: `ValidatePermissionForInput<P, I>` resolves to P
 * when the input carries a usable scope id, and to a `DeclarationError`
 * otherwise. These pin the declaration surface every framework (tRPC
 * builder, HTTP route policy) is typed against.
 */
describe("ValidatePermissionForInput", () => {
  describe("given a project-scoped permission and a matching input", () => {
    /** @scenario "A declared permission reads its scope from the validated input" */
    it("resolves to the permission itself", () => {
      type Result = ValidatePermissionForInput<"traces:view", { projectId: string }>;
      type _Compiles = Assert<Equal<Result, "traces:view">>;
      expect(true satisfies _Compiles).toBe(true);
    });
  });

  describe("given an input naming no scope id the permission can use", () => {
    /** @scenario "Declaring a permission with no usable scope id in the input fails to compile" */
    /** @scenario "A declaration that cannot resolve a scope from its input fails the sweep" */
    it("resolves to a declaration error", () => {
      type Result = ValidatePermissionForInput<"traces:view", { name: string }>;
      type _Refuses = Assert<Equal<Result extends DeclarationError<string> ? true : false, true>>;
      expect(true satisfies _Refuses).toBe(true);
    });
  });

  describe("given an input carrying only an id from a tier the permission cannot be granted at", () => {
    /** @scenario "An input id from a tier the permission cannot be granted at fails to compile" */
    it("resolves to a declaration error", () => {
      type Result = ValidatePermissionForInput<"governance:view", { projectId: string }>;
      type _Refuses = Assert<Equal<Result extends DeclarationError<string> ? true : false, true>>;
      expect(true satisfies _Refuses).toBe(true);
    });
  });

  describe("given a platform-tier permission", () => {
    /** @scenario "A platform-tier permission is refused by the scoped declaration surface" */
    it("resolves to a declaration error regardless of the input", () => {
      type Result = ValidatePermissionForInput<"ops:view", { organizationId: string }>;
      type _Refuses = Assert<Equal<Result extends DeclarationError<string> ? true : false, true>>;
      expect(true satisfies _Refuses).toBe(true);
    });
  });

  describe("given a union input", () => {
    /** @scenario "An input modelled as a union is checked per member" */
    it("validates each member independently", () => {
      type Result = ValidatePermissionForInput<
        "project:update",
        { projectId: string } | { organizationId: string }
      >;
      // Both members carry a usable id for project:update (project and
      // organization are both grantable tiers), so the union validates
      // member-by-member rather than being refused as a whole.
      type _Compiles = Assert<Equal<Result, "project:update">>;
      expect(true satisfies _Compiles).toBe(true);
    });
  });
});

/**
 * The imperative facade's own scope argument: exactly one id, at a tier the
 * permission is grantable at. Backs `AuthzService.authorizePermission` and
 * `hasPermission`, which read their scope from this type rather than from a
 * validated tRPC input.
 */
describe("PermissionScopeArg", () => {
  describe("given a permission grantable at the project tier", () => {
    /** @scenario "An imperative check names its scope id to match the permission" */
    it("accepts a matching projectId argument", () => {
      type Arg = PermissionScopeArg<"traces:view">;
      type _Compiles = Assert<{ projectId: string } extends Arg ? true : false>;
      expect(true satisfies _Compiles).toBe(true);
    });
  });

  describe("given an organization-only permission", () => {
    /** @scenario "An imperative check names its scope id to match the permission" */
    it("refuses a projectId argument, admitting only organizationId", () => {
      type Arg = PermissionScopeArg<"governance:view">;
      type _ProjectIdRefused = Assert<
        { projectId: string } extends Arg ? false : true
      >;
      type _OrganizationIdAccepted = Assert<{ organizationId: string } extends Arg ? true : false>;
      expect(true satisfies _ProjectIdRefused).toBe(true);
      expect(true satisfies _OrganizationIdAccepted).toBe(true);
    });
  });
});
