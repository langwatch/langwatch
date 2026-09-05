/** @vitest-environment node */

/**
 * The tRPC adapter for the lineage guard: it hands the input to the
 * authorization port's `checkScopeLineage` and shapes the refusal. The
 * lineage DECISION itself — which organizations a mismatched request touches
 * — is `@langwatch/authz-contract`'s own business.
 */
import type {
  AuthzScopeLineageInput,
  AuthzScopeLineageResult,
} from "@langwatch/authz-contract";
import { PermissionDeniedError } from "@langwatch/authz-contract";
import type { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import type { TrpcAuthorizationPort } from "../trpc-policy-ports.js";
import { createScopeLineageGuard } from "../trpc-scope-lineage.js";

function makePorts(
  checkScopeLineage: ReturnType<
    typeof vi.fn<(input: AuthzScopeLineageInput) => Promise<AuthzScopeLineageResult>>
  >,
): Readonly<{ authorization: TrpcAuthorizationPort<unknown> }> {
  return {
    authorization: {
      forRequest: () => ({
        checkScopeLineage,
        getDecision: vi.fn(),
        getProjectAnyDecision: vi.fn(),
      }),
    },
  };
}

const rejection = async (run: () => Promise<unknown>): Promise<TRPCError> => {
  try {
    await run();
  } catch (error) {
    return error as TRPCError;
  }
  throw new Error("expected the guard to throw");
};

describe("createScopeLineageGuard", () => {
  describe("when the port reports a mismatch across organizations", () => {
    /** @scenario "Scope ids from two organizations in one request are refused" */
    it("refuses before the handler runs, shaped as a permission denial", async () => {
      const checkScopeLineage = vi
        .fn<(input: AuthzScopeLineageInput) => Promise<AuthzScopeLineageResult>>()
        .mockResolvedValue({
        kind: "mismatch",
        widest: { tier: "organization", id: "org_victim" },
        entries: [],
      });
      const guard = createScopeLineageGuard(makePorts(checkScopeLineage));
      const next = vi.fn();

      const error = await rejection(() =>
        guard({ kind: "permission", permission: "auditLog:view" })({
          ctx: {},
          input: { organizationId: "org_victim", projectId: "project_mine" },
          next,
        }),
      );

      expect(checkScopeLineage).toHaveBeenCalledWith({
        organizationId: "org_victim",
        projectId: "project_mine",
      });
      expect(next).not.toHaveBeenCalled();
      expect(error.cause).toBeInstanceOf(PermissionDeniedError);
      expect((error.cause as PermissionDeniedError).meta).toMatchObject({
        permission: "auditLog:view",
        scopeType: "organization",
      });
    });
  });

  describe("when a scope id resolves to no organization at all", () => {
    /** @scenario "A scope id resolving to no organization cannot anchor a mixed request" */
    it("fails closed on the port's mismatch verdict rather than treating it as agreeing", async () => {
      const checkScopeLineage = vi
        .fn<(input: AuthzScopeLineageInput) => Promise<AuthzScopeLineageResult>>()
        .mockResolvedValue({
        kind: "mismatch",
        widest: { tier: "project", id: "project_ghost" },
        entries: [],
      });
      const guard = createScopeLineageGuard(makePorts(checkScopeLineage));
      const next = vi.fn();

      await expect(
        guard({ kind: "permission", permission: "auditLog:view" })({
          ctx: {},
          input: { organizationId: "org_1", projectId: "project_ghost" },
          next,
        }),
      ).rejects.toBeInstanceOf(Error);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("when every scope id resolves to one organization", () => {
    /** @scenario "A request whose scope ids agree passes the lineage guard untouched" */
    it("passes through to the declared check", async () => {
      const checkScopeLineage = vi
        .fn<(input: AuthzScopeLineageInput) => Promise<AuthzScopeLineageResult>>()
        .mockResolvedValue({ kind: "consistent" });
      const guard = createScopeLineageGuard(makePorts(checkScopeLineage));
      const next = vi.fn().mockReturnValue("handled");

      await expect(
        guard({ kind: "permission", permission: "auditLog:view" })({
          ctx: {},
          input: { organizationId: "org_1", teamId: "team_1", projectId: "project_1" },
          next,
        }),
      ).resolves.toBe("handled");
      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});
