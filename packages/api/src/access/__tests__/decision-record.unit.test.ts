/**
 * Who an authorization decision names (D06), as main's decisionRecord test.
 * Spec: specs/identity/mfa-and-session-shape.feature.
 */
import { PermissionDeniedError } from "@langwatch/authorization";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { authorizeDefaults } from "../../__tests__/api-double.ts";
import { decide, type AccessDenial, type Authorize, type Caller } from "../access.ts";
import type * as decisionRecordModule from "../decision-record.ts";
import { permissionDecisionRecord, recordPermissionDecision } from "../decision-record.ts";

vi.mock("../decision-record.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof decisionRecordModule>();
  return { ...actual, recordPermissionDecision: vi.fn() };
});

const operatorAsSam = { type: "user", id: "sam", impersonatorId: "operator_1" } as const;
const scope = { tier: "organization", id: "org_acme" } as const;

const denials: AccessDenial = {
  membershipDisabled: () => new Error("membership disabled"),
  liteMemberRestricted: (resource) => new Error(`lite member: ${resource}`),
};

function authorize({ permitted }: { permitted: boolean }): Authorize {
  return {
    ...authorizeDefaults,
    getDecision: async () =>
      permitted
        ? { permitted, organizationRole: null }
        : { permitted, organizationRole: null, denialReason: "no-grant" },
    getProjectAnyDecision: async () => ({ permitted, organizationRole: null }),
    checkScopeLineage: async () => ({ kind: "consistent" }),
  };
}

describe("an authorization decision", () => {
  beforeEach(() => {
    vi.mocked(recordPermissionDecision).mockClear();
  });

  describe("given an operator impersonating somebody", () => {
    describe("when any authorization decision is made for that session", () => {
      /** @scenario "Every authorization decision under impersonation names both people" */
      it("records the operator and the person whose access was borrowed", () => {
        const record = permissionDecisionRecord({
          actor: operatorAsSam,
          permission: "organization:manage",
          scope,
          permitted: true,
        });

        expect(record.actorUserId).toBe("operator_1");
        expect(record.subjectUserId).toBe("sam");
        expect(record.impersonating).toBe(true);
      });

      /** @scenario "Every authorization decision under impersonation names both people" */
      it("names both on a refusal as well as on a grant", () => {
        const record = permissionDecisionRecord({
          actor: operatorAsSam,
          permission: "organization:manage",
          scope,
          permitted: false,
          denialReason: "no-grant",
        });

        expect(record).toMatchObject({
          actorUserId: "operator_1",
          subjectUserId: "sam",
          impersonating: true,
          permitted: false,
          denialReason: "no-grant",
          permission: "organization:manage",
          scopeTier: "organization",
          scopeId: "org_acme",
        });
      });

      /** @scenario "Every authorization decision under impersonation names both people" */
      it("can answer who really did it from the record alone", () => {
        const record = permissionDecisionRecord({
          actor: operatorAsSam,
          permission: "project:view",
          scope: { tier: "project", id: "proj_1" },
          permitted: true,
        });

        expect(record.actorUserId).not.toBe(record.subjectUserId);
        expect(record.actorUserId).toBe("operator_1");
      });

      /** @scenario "Every authorization decision under impersonation names both people" */
      it("hands the door's grant and its refusal to the record, both naming the pair", async () => {
        const caller: Caller = { actor: operatorAsSam };
        const declaration = { kind: "permission", permission: "project:view" } as const;
        const input = { projectId: "proj_1" };

        await decide({
          declaration,
          caller,
          input,
          authorize: authorize({ permitted: true }),
          denials,
        });
        await expect(
          decide({
            declaration,
            caller,
            input,
            authorize: authorize({ permitted: false }),
            denials,
          }),
        ).rejects.toBeInstanceOf(PermissionDeniedError);

        const recorded = vi.mocked(recordPermissionDecision).mock.calls.map(([record]) => record);
        expect(recorded).toEqual([
          expect.objectContaining({
            permitted: true,
            actorUserId: "operator_1",
            subjectUserId: "sam",
          }),
          expect.objectContaining({
            permitted: false,
            denialReason: "no-grant",
            actorUserId: "operator_1",
            subjectUserId: "sam",
            impersonating: true,
          }),
        ]);
      });
    });
  });

  describe("given somebody acting as themselves", () => {
    it("names the same person twice rather than nobody", () => {
      const record = permissionDecisionRecord({
        actor: { type: "user", id: "sam" },
        permission: "project:view",
        scope: { tier: "project", id: "proj_1" },
        permitted: true,
      });

      expect(record.actorUserId).toBe("sam");
      expect(record.subjectUserId).toBe("sam");
      expect(record.impersonating).toBe(false);
    });

    it("reads an impersonator of oneself as no impersonation at all", () => {
      const record = permissionDecisionRecord({
        actor: { type: "user", id: "sam", impersonatorId: "sam" },
        permission: "project:view",
        scope: { tier: "project", id: "proj_1" },
        permitted: true,
      });

      expect(record.impersonating).toBe(false);
    });
  });
});
