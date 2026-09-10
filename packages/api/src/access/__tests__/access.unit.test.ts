/**
 * The three access decisions, and the four refusals behind them.
 *
 * Spec: packages/api/specs/transport-declaration-split.feature.
 */

import { BlankScopeIdError, PermissionDeniedError } from "@langwatch/authz-contract";
import { describe, expect, it } from "vitest";

import { ScopeInputMismatchError } from "../../errors.ts";
import {
  AccessWiringError,
  AuthenticationRequiredError,
  decide,
  deferredScope,
  optionalCredential,
  securityRequirement,
  type AccessDenial,
  type AuthorizePort,
  type Caller,
} from "../access.ts";

const reviewer: Caller = { actor: { type: "user", id: "reviewer-1" } };

const denials: AccessDenial = {
  membershipDisabled: () => new Error("membership disabled"),
  liteMemberRestricted: (resource) => new Error(`lite member: ${resource}`),
};

function authorize(
  overrides: Partial<AuthorizePort> = {},
  seen: { decisions: unknown[] } = { decisions: [] },
): AuthorizePort {
  return {
    getDecision: async (input) => {
      seen.decisions.push(input);

      return { permitted: true, organizationRole: null };
    },
    getProjectAnyDecision: async (input) => {
      seen.decisions.push(input);

      return { permitted: true, organizationRole: null };
    },
    checkScopeLineage: async () => ({ kind: "consistent" }),
    ...overrides,
  };
}

describe("deciding access for one call", () => {
  describe("given the declaration names one permission", () => {
    /** @scenario "A tRPC call runs one execution path" */
    it("checks it at the scope the validated input names, and answers actor and scope", async () => {
      const seen = { decisions: [] as unknown[] };

      const decision = await decide({
        declaration: { kind: "permission", permission: "annotations:view" },
        caller: reviewer,
        input: { projectId: "project-1" },
        authorize: authorize({}, seen),
        denials,
      });

      expect(seen.decisions).toEqual([
        {
          userId: "reviewer-1",
          permission: "annotations:view",
          scope: { tier: "project", id: "project-1" },
        },
      ]);

      expect(decision).toEqual({
        actor: { type: "user", id: "reviewer-1" },
        scope: { tier: "project", id: "project-1" },
      });
    });

    it("refuses an anonymous caller before reading any scope id", async () => {
      await expect(
        decide({
          declaration: { kind: "permission", permission: "annotations:view" },
          caller: { actor: null },
          input: { projectId: "project-1" },
          authorize: authorize(),
          denials,
        }),
      ).rejects.toBeInstanceOf(AuthenticationRequiredError);
    });

    it("answers a refusal as a permission denial naming the scope", async () => {
      const refusing = authorize({
        getDecision: async () => ({ permitted: false, organizationRole: null }),
      });

      await expect(
        decide({
          declaration: { kind: "permission", permission: "annotations:view" },
          caller: reviewer,
          input: { projectId: "project-1" },
          authorize: refusing,
          denials,
        }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
  });

  describe("given the input names a scope field it left empty", () => {
    it("answers a blank scope id, which the caller can fix, not a wiring bug", async () => {
      await expect(
        decide({
          declaration: { kind: "permission", permission: "annotations:view" },
          caller: reviewer,
          input: { projectId: "" },
          authorize: authorize(),
          denials,
        }),
      ).rejects.toBeInstanceOf(BlankScopeIdError);
    });
  });

  describe("given the input names no scope field at all", () => {
    it("answers a wiring bug the caller cannot act on", async () => {
      await expect(
        decide({
          declaration: { kind: "permission", permission: "annotations:view" },
          caller: reviewer,
          input: {},
          authorize: authorize(),
          denials,
        }),
      ).rejects.toBeInstanceOf(AccessWiringError);
    });
  });

  describe("given the scope ids do not share one organization", () => {
    it("refuses before any permission is checked", async () => {
      const mismatched = authorize({
        checkScopeLineage: async () => ({
          kind: "mismatch",
          widest: { tier: "organization", id: "organization-2" },
          entries: [],
        }),
      });

      await expect(
        decide({
          declaration: { kind: "permission", permission: "annotations:view" },
          caller: reviewer,
          input: { projectId: "project-1" },
          authorize: mismatched,
          denials,
        }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
  });

  describe("given the credential resolved a project of its own", () => {
    /** The refusal itself, so its wire form can be read rather than matched. */
    async function refuseMismatch(): Promise<ScopeInputMismatchError> {
      try {
        await decide({
          declaration: { kind: "service-authorized", reason: "the door", permissions: [] },
          caller: { actor: null, scope: { tier: "project", id: "project-1" } },
          input: { projectId: "project-2" },
        });
      } catch (error) {
        if (error instanceof ScopeInputMismatchError) return error;

        throw error;
      }

      throw new Error("the input project id was accepted");
    }

    /** @scenario "A project id the credential did not resolve is a handled refusal" */
    it("refuses an input project id that disagrees with it, as a forbidden the caller can act on", async () => {
      const refused = await refuseMismatch();

      expect(refused.code).toBe("scope_input_mismatch");
      expect(refused.httpStatus).toBe(403);
    });

    /** @scenario "A project id the credential did not resolve is a handled refusal" */
    it("names the offending field and neither project", async () => {
      const refused = await refuseMismatch();
      const wire = JSON.stringify(refused.serialize());

      expect(refused.meta).toEqual({ field: "projectId" });
      expect(wire).not.toContain("project-1");
      expect(wire).not.toContain("project-2");
    });
  });

  describe("given the declaration is deliberately unchecked", () => {
    it("refuses a scope field it did not individually allow with a reason", async () => {
      await expect(
        decide({
          declaration: { kind: "no-permission", reason: "public read" },
          caller: reviewer,
          input: { projectId: "project-1" },
        }),
      ).rejects.toThrow(/projectId is not allowed to be used without permission check/);
    });

    it("passes one it did allow", async () => {
      const decision = await decide({
        declaration: {
          kind: "no-permission",
          reason: "public read",
          allow: { projectId: "the row is the caller's own" },
        },
        caller: reviewer,
        input: { projectId: "project-1" },
      });

      expect(decision).toEqual({ actor: { type: "user", id: "reviewer-1" }, scope: null });
    });
  });

  describe("given the surface supplied no authorization port", () => {
    it("refuses a declaration whose check it cannot run, by name", async () => {
      await expect(
        decide({
          declaration: { kind: "permission", permission: "annotations:view" },
          caller: reviewer,
          input: { projectId: "project-1" },
        }),
      ).rejects.toThrow(/"permission" access declaration needs an authorization port/);
    });
  });
});

describe("the security requirement one credential publishes", () => {
  it("names the scheme an API client presents", () => {
    expect(securityRequirement("project")).toEqual([{ project_api_key: [] }]);
    expect(securityRequirement("organization")).toEqual([{ admin_api_key: [] }]);
    expect(securityRequirement("public")).toEqual([]);
  });

  /** @scenario "A family behind a deployment secret publishes the secret's own scheme" */
  it("names the scheme for a credential held outside the deployment", () => {
    expect(securityRequirement("scimToken")).toEqual([{ scim_bearer: [] }]);
    expect(securityRequirement("internalSecret")).toEqual([{ internal_secret: [] }]);
  });

  it("refuses a credential no API client can present", () => {
    expect(() => securityRequirement("browser")).toThrow(/no security scheme/);
  });
});

describe("the two access kinds that answer for nobody in particular", () => {
  /** @scenario "A route answers with or without the family's credential" */
  it("declares an optional credential with the written reason it is safe either way", () => {
    expect(optionalCredential({ reason: "a key only links the report to a project" })).toEqual({
      kind: "optional",
      reason: "a key only links the report to a project",
    });

    expect(() => optionalCredential({ reason: "  " })).toThrow(/needs a written reason/);
  });

  /** @scenario "A route whose resource names its own owner resolves the scope in its handler" */
  it("declares a deferred scope with the written reason the handler resolves it", () => {
    expect(deferredScope({ reason: "only the row knows which project owns it" })).toEqual({
      kind: "deferred",
      reason: "only the row knows which project owns it",
    });

    expect(() => deferredScope({ reason: "" })).toThrow(/needs a written reason/);
  });
});

describe("the security requirement the instance administrator's key publishes", () => {
  /** @scenario "A family behind the instance administrator's own key names no tenant" */
  it("names the scheme the operator presents", () => {
    expect(securityRequirement("instance-admin")).toEqual([{ instance_admin_key: [] }]);
  });
});
