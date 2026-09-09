/**
 * @vitest-environment node
 * The three namespaces the project mounts: wire names, kinds, declared answers
 * and the access each procedure carries. Read back off the declaration itself,
 * so nothing here depends on the shape of a tRPC internal.
 */
import type { TrpcAccess, TrpcProcedureRequest } from "@langwatch/api/trpc";
import { homeTrpc, integrationsChecksTrpc, projectTrpc } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import { homeTrpcTransport } from "../home.trpc.ts";
import { integrationsChecksTrpcTransport } from "../integrations-checks.trpc.ts";
import { projectTrpcTransport } from "../project.trpc.ts";

/** What a declaration asks a runtime to build, collected instead of built. */
type Declared = Readonly<{ router(factory: never, app: never): unknown }>;

function declaredAccess(transport: Declared): Record<string, TrpcAccess> {
  const declared: Record<string, TrpcAccess> = {};
  const factory = {
    procedure: (request: TrpcProcedureRequest<object>) => {
      declared[request.procedure] = request.access;

      return null;
    },
    router: (record: Readonly<Record<string, unknown>>) => record,
  };

  transport.router(factory as never, (() => ({})) as never);

  return declared;
}

describe("the project tRPC declarations", () => {
  describe("given the contract the browser reads", () => {
    it("keeps the namespace and the procedure names of each surface", () => {
      expect(projectTrpc.namespace).toBe("project");
      expect(Object.keys(projectTrpc.members).sort()).toEqual([
        "archiveById",
        "create",
        "getFieldRedactionStatus",
        "getHasFirstMessage",
        "getProjectAPIKey",
        "regenerateApiKey",
        "triggerTopicClustering",
        "update",
      ]);
      expect(homeTrpc.namespace).toBe("home");
      expect(Object.keys(homeTrpc.members)).toEqual(["getRecentItems"]);
      expect(integrationsChecksTrpc.namespace).toBe("integrationsChecks");
      expect(Object.keys(integrationsChecksTrpc.members)).toEqual(["getCheckStatus"]);
    });

    it("reads with a query and changes with a mutation", () => {
      expect(
        Object.fromEntries(
          Object.entries(projectTrpc.members).map(([name, member]) => [name, member.kind]),
        ),
      ).toEqual({
        create: "mutation",
        getProjectAPIKey: "query",
        getHasFirstMessage: "query",
        regenerateApiKey: "mutation",
        update: "mutation",
        getFieldRedactionStatus: "query",
        archiveById: "mutation",
        triggerTopicClustering: "mutation",
      });
      expect(homeTrpc.members.getRecentItems?.kind).toBe("query");
      expect(integrationsChecksTrpc.members.getCheckStatus?.kind).toBe("query");
    });

    it("declares an answer for every procedure", () => {
      for (const [name, member] of Object.entries(projectTrpc.members)) {
        expect([name, member.output !== undefined]).toEqual([name, true]);
      }
      expect(homeTrpc.members.getRecentItems?.output).toBeDefined();
      expect(integrationsChecksTrpc.members.getCheckStatus?.output).toBeDefined();
    });
  });

  describe("given the server half a process mounts", () => {
    it("keeps the gate each project procedure has always carried", () => {
      expect(declaredAccess(projectTrpcTransport)).toEqual({
        // The tier a create is judged at depends on what it asked for, so the
        // handler resolves it and the declaration records both permissions.
        "project.create": {
          kind: "service-authorized",
          reason: expect.any(String),
          permissions: ["project:create", "organization:manage"],
          enforces: { teamId: expect.any(String), organizationId: expect.any(String) },
        },
        // The base key is a project-level write credential, so reading it
        // costs what it grants.
        "project.getProjectAPIKey": { kind: "permission", permission: "project:update" },
        "project.getHasFirstMessage": { kind: "permission", permission: "project:view" },
        "project.regenerateApiKey": { kind: "permission", permission: "project:manage" },
        "project.update": { kind: "permission", permission: "project:update" },
        "project.getFieldRedactionStatus": { kind: "permission", permission: "project:view" },
        "project.archiveById": { kind: "permission", permission: "project:delete" },
        "project.triggerTopicClustering": { kind: "permission", permission: "project:update" },
      });
    });

    it("gates the recent-items strip on project:view", () => {
      expect(declaredAccess(homeTrpcTransport)).toEqual({
        "home.getRecentItems": { kind: "permission", permission: "project:view" },
      });
    });

    /**
     * `project:update` rather than `project:view`: the answer drives the setup
     * checklist, and a reader who cannot change the project cannot act on a
     * single step it lists.
     */
    it("gates the setup checklist on project:update", () => {
      expect(declaredAccess(integrationsChecksTrpcTransport)).toEqual({
        "integrationsChecks.getCheckStatus": {
          kind: "permission",
          permission: "project:update",
        },
      });
    });
  });
});
