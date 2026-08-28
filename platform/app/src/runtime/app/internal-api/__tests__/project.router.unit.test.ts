/**
 * The process policy wrapped around the package-owned project transport: the
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
import { projectRouter } from "../project.router";
import type { RequestAppServices } from "~/runtime/app/requestApp";
import { isPublicProcedure } from "~/server/api/trpc.permission-builder";
import { createInnerTRPCContext } from "~/server/api/trpc";

const procedures = (projectRouter as unknown as { _def: { procedures: Record<string, unknown> } })
  ._def.procedures;

function declarationOf(procedure: unknown): AuthzDeclaration | null {
  const middlewares = ((procedure as { _def?: { middlewares?: unknown[] } })._def?.middlewares ??
    []) as unknown[];
  return middlewares.map(authzDeclarationOf).find((found) => found !== null) ?? null;
}

describe("project transport mount", () => {
  describe("given the composed router", () => {
    it("keeps the procedure names the browser calls", () => {
      expect(Object.keys(procedures).sort()).toEqual([
        "archiveById",
        "create",
        "getFieldRedactionStatus",
        "getHasFirstMessage",
        "getProjectAPIKey",
        "regenerateApiKey",
        "triggerTopicClustering",
        "update",
      ]);
    });

    it("declares an access decision on every procedure", () => {
      const undeclared = Object.entries(procedures)
        .filter(([, procedure]) => declarationOf(procedure) === null)
        .map(([path]) => path);

      expect(undeclared).toEqual([]);
    });

    it("declares the permission each procedure was gated with before it moved", () => {
      const declared = Object.fromEntries(
        Object.entries(procedures).map(([path, procedure]) => [path, declarationOf(procedure)]),
      );

      expect(declared).toMatchObject({
        create: {
          kind: "custom",
          permissions: ["project:create", "organization:manage"],
        },
        getProjectAPIKey: { kind: "permission", permission: "project:update" },
        getHasFirstMessage: { kind: "permission", permission: "project:view" },
        regenerateApiKey: { kind: "permission", permission: "project:manage" },
        update: { kind: "permission", permission: "project:update" },
        getFieldRedactionStatus: { kind: "permission", permission: "project:view" },
        archiveById: { kind: "permission", permission: "project:delete" },
        triggerTopicClustering: { kind: "permission", permission: "project:update" },
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
    it("refuses before the project service is reached", async () => {
      const projects = {
        tryGetById: () => {
          throw new Error("the project service must not be reached");
        },
      };
      const caller = projectRouter.createCaller(
        createInnerTRPCContext({
          app: { projects } as unknown as RequestAppServices,
          session: null,
          permissionChecked: false,
          publiclyShared: false,
        }),
      );

      await expect(caller.getHasFirstMessage({ projectId: "project_123" })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });
  });
});
