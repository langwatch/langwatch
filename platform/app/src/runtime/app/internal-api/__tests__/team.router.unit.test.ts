/**
 * The process policy wrapped around the package-owned team transport: the
 * surface stays authenticated, every procedure's access decision stays
 * declared so the fail-closed backstop is satisfied, and the procedure names
 * remain the compatibility contract the browser calls.
 *
 * The declaration check matters more here than the name check. The package
 * applies the process policy AFTER its own `.input()` parser, because tRPC
 * appends the input middleware where `.input()` is called and anything
 * installed ahead of it runs with no input at all — an authorization check
 * that resolves its scope id from the input would then read nothing while
 * every guard still reported green.
 *
 * @vitest-environment node
 */
import { authzDeclarationOf, type AuthzDeclaration } from "@langwatch/authz-contract";
import { describe, expect, it } from "vitest";
import { teamRouter } from "../team.router";
import type { RequestAppServices } from "~/runtime/app/requestApp";
import { isPublicProcedure } from "~/server/api/trpc.permission-builder";
import { createInnerTRPCContext } from "~/server/api/trpc";

const procedures = (teamRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def
  .procedures;

function declarationOf(procedure: unknown): AuthzDeclaration | null {
  const middlewares = ((procedure as { _def?: { middlewares?: unknown[] } })._def?.middlewares ??
    []) as unknown[];
  return middlewares.map(authzDeclarationOf).find((found) => found !== null) ?? null;
}

describe("team transport mount", () => {
  describe("given the composed router", () => {
    it("keeps the procedure names the browser calls", () => {
      expect(Object.keys(procedures).sort()).toEqual([
        "archiveById",
        "createTeamWithMembers",
        "getBySlug",
        "getTeamWithMembers",
        "getTeamsWithMembers",
        "getTeamsWithRoleBindings",
        "removeMember",
        "update",
      ]);
    });

    it("declares the permission each procedure was gated with before it moved", () => {
      const declared = Object.fromEntries(
        Object.entries(procedures).map(([path, procedure]) => [path, declarationOf(procedure)]),
      );

      expect(declared).toMatchObject({
        getBySlug: { kind: "permission", permission: "organization:view" },
        getTeamsWithMembers: { kind: "permission", permission: "organization:view" },
        getTeamsWithRoleBindings: { kind: "permission", permission: "organization:manage" },
        getTeamWithMembers: { kind: "permission", permission: "organization:view" },
        update: { kind: "permission", permission: "team:manage" },
        createTeamWithMembers: { kind: "permission", permission: "organization:manage" },
        archiveById: { kind: "permission", permission: "team:manage" },
        removeMember: { kind: "permission", permission: "team:manage" },
      });
    });

    it("leaves nothing on the surface callable without a session", () => {
      const publicProcedures = Object.entries(procedures)
        .filter(([, procedure]) => isPublicProcedure(procedure))
        .map(([path]) => path);

      expect(publicProcedures).toEqual([]);
    });
  });

  describe("when the caller has no session", () => {
    it("refuses before the organization service is reached", async () => {
      const organizations = {
        getTeamBySlugForMember: () => {
          throw new Error("the organization service must not be reached");
        },
      };
      const caller = teamRouter.createCaller(
        createInnerTRPCContext({
          app: { organizations } as unknown as RequestAppServices,
          session: null,
          permissionChecked: false,
          publiclyShared: false,
        }),
      );

      await expect(
        caller.getBySlug({ organizationId: "org-1", slug: "engineering" }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });
});
