/**
 * The workflow module's wire, pinned: every procedure and route, with the
 * permission bound to it. A rename here breaks a browser cache key or a URL.
 * Spec: packages/api/specs/transport-declaration-split.feature.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { TrpcProcedureFactory } from "@langwatch/api/trpc";
import { workflowOptimizationTrpc, workflowTrpc } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { workflowOptimizationTrpcTransport } from "../workflow-optimization.trpc.ts";
import { workflowRunRest } from "../workflow-run.rest.ts";
import { workflowStudioRest } from "../workflow-studio.rest.ts";
import { createWorkflowRest } from "../workflow.rest.ts";
import { workflowTrpcTransport } from "../workflow.trpc.ts";

/** A mounted tRPC declaration, as this table reads it back. */
type MountableTrpc = Readonly<{
  router(runtime: TrpcProcedureFactory<object>, app: () => never): unknown;
}>;

/** Mounts a declaration and records the access each procedure asked for. */
function permissionsOf(declaration: MountableTrpc): (AuthzPermission | object)[] {
  const declared: (AuthzPermission | object)[] = [];

  const runtime: TrpcProcedureFactory<object> = {
    procedure: ({ access }) => {
      declared.push(access.kind === "permission" ? access.permission : access);

      return {};
    },
    router: (record) => record,
  };

  declaration.router(runtime, () => {
    throw new Error("the wire table never resolves an application");
  });

  return declared;
}

const platformUrl = ({ projectSlug, path }: { projectSlug: string; path: string }) =>
  `https://app.langwatch.test/${projectSlug}${path}`;

/** Every route a family declares, as method, path, operation and permission. */
function routesOf(declaration: { router: () => { routes: readonly unknown[] } }) {
  return declaration.router().routes.map((route) => {
    const declared = route as {
      method: string;
      path: string;
      operation: string;
      permission?: string;
      access?: { kind: string };
    };

    return [
      declared.method.toUpperCase(),
      declared.path,
      declared.operation,
      declared.permission ?? declared.access?.kind,
    ];
  });
}

describe("the workflow module's transport declarations", () => {
  describe("given the contract and the server it is bound to", () => {
    /** @scenario "The server repeats nothing the contract said" */
    it("keeps the workflow wire names, kinds and permissions", () => {
      const table = Object.entries(workflowTrpc.members).map(([name, member], index) => [
        name,
        member.kind,
        permissionsOf(workflowTrpcTransport)[index],
      ]);

      expect(table).toEqual([
        ["engineMode", "query", "workflows:view"],
        ["create", "mutation", "workflows:create"],
        ["copy", "mutation", "workflows:create"],
        ["getAll", "query", "workflows:view"],
        ["getCopies", "query", "workflows:view"],
        ["getById", "query", "workflows:view"],
        ["getVersions", "query", "workflows:view"],
        ["restoreVersion", "mutation", "workflows:update"],
        ["autosave", "mutation", "workflows:update"],
        ["commitVersion", "mutation", "workflows:update"],
        ["publish", "mutation", "workflows:update"],
        ["unpublish", "mutation", "workflows:update"],
        ["syncFromSource", "mutation", "workflows:update"],
        ["pushToCopies", "mutation", "workflows:update"],
        ["getRelatedEntities", "query", "workflows:view"],
        ["cascadeArchive", "mutation", "workflows:delete"],
        ["archive", "mutation", "workflows:delete"],
        ["generateCommitMessage", "mutation", "workflows:update"],
      ]);
    });

    /**
     * Finding H9 of the 2026-09-04 security pass: `optimization.chat` runs a
     * published workflow, so it declares the run endpoint's own permission.
     * Spec: specs/security/resource-scope-permission-checks.feature
     * @scenario "Starting an optimization chat demands the permission to run a workflow"
     */
    it("keeps the optimization wire names, kinds and permissions", () => {
      const table = Object.entries(workflowOptimizationTrpc.members).map(
        ([name, member], index) => [
          name,
          member.kind,
          permissionsOf(workflowOptimizationTrpcTransport)[index],
        ],
      );

      expect(table).toEqual([
        ["chat", "mutation", "workflows:manage"],
        ["getPublishedWorkflow", "query", "workflows:view"],
        ["disableAsComponent", "mutation", "workflows:update"],
        ["disableAsEvaluator", "mutation", "workflows:update"],
        ["toggleSaveAsComponent", "mutation", "workflows:update"],
        ["toggleSaveAsEvaluator", "mutation", "workflows:update"],
        ["getComponents", "query", "workflows:view"],
      ]);
    });
  });

  describe("given the REST families the module declares", () => {
    it("keeps the /api/workflows management addresses", () => {
      expect(routesOf(createWorkflowRest(platformUrl))).toEqual([
        ["GET", "/", "listWorkflows", "workflows:view"],
        ["GET", "/:id", "getWorkflow", "workflows:view"],
        ["PATCH", "/:id", "updateWorkflow", "workflows:update"],
        ["DELETE", "/:id", "archiveWorkflow", "workflows:manage"],
        ["POST", "/:id/evaluate", "evaluateWorkflow", "workflows:create"],
      ]);
      expect(createWorkflowRest(platformUrl).router().namespace).toBe("workflows");
    });

    it("keeps the three synchronous run addresses, literally", () => {
      expect(routesOf(workflowRunRest)).toEqual([
        [
          "POST",
          "/api/optimization/:workflowId/:versionId",
          "runOptimizationWorkflowVersion",
          "workflows:manage",
        ],
        ["POST", "/api/workflows/:workflowId/run", "runWorkflow", "workflows:manage"],
        [
          "POST",
          "/api/workflows/:workflowId/:versionId/run",
          "runWorkflowVersion",
          "workflows:manage",
        ],
      ]);
      expect(workflowRunRest.router().addressing).toBe("literal");
    });

    it("keeps the studio editor's two doors, answering their own refusals", () => {
      expect(routesOf(workflowStudioRest)).toEqual([
        ["POST", "/api/workflows/code-completion", "completeWorkflowCode", "public"],
        ["POST", "/api/workflows/post_event", "postWorkflowStudioEvent", "public"],
      ]);
      expect(workflowStudioRest.router().credential).toBe("browser");
    });
  });
});
