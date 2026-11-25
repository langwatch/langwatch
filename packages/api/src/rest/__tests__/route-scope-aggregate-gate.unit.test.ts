/**
 * A REST route that names its project in its path applies the aggregate admin gate on REST
 * route scopes (ADR-177 decision 5). Spec: specs/governance/aggregate-project.feature.
 */
import type { PermissionDecision } from "@langwatch/authorization";
import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { authorizeDefaults } from "../../__tests__/api-double.ts";
import { createErrorHandler } from "../../errors.ts";
import type { RestIdentity } from "../../hosting/api-door.ts";
import { defineRestRouter } from "../declaration.ts";
import { createRestRuntime } from "../runtime.ts";

type ProjectsApi = { read(input: { projectId: string }): Promise<{ id: string }> };

const ProjectsApi = moduleApi<ProjectsApi>()("project");
const VERSION = "2026-10-09";

function mounted({
  kind,
  organizationRole,
}: {
  kind: string;
  organizationRole: PermissionDecision["organizationRole"];
}) {
  const ran: string[] = [];
  const caller = {
    actor: { type: "user", id: "user_sam" },
    scope: { tier: "organization", id: "org_acme" },
  } as const;
  const door: RestIdentity = {
    authenticate: () => caller,
    identify: () => caller,
    authorize: async () => ({ permitted: true, organizationRole }),
  };
  const routes = defineRestRouter(ProjectsApi)
    .withNamespace("projects")
    .withVersion(VERSION)
    .withCredential("organization")
    .get("/:projectId", "getProject")
    .withParams(z.object({ projectId: z.string() }))
    .withPermission("project:view", { at: "route", param: "projectId" })
    .withOutput(z.object({ id: z.string() }))
    .handle(({ app, input }) => app.read({ projectId: input.projectId }))
    .build()
    .router();
  const app: ProjectsApi = {
    read: async ({ projectId }) => {
      ran.push(projectId);

      return { id: projectId };
    },
  };
  const server = createRestRuntime({
    identity: door,
    authorization: {
      forRequest: () => ({
        ...authorizeDefaults,
        getDecision: async () => ({ permitted: true, organizationRole }),
        getProjectAnyDecision: async () => ({ permitted: true, organizationRole }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
        projectKindOf: async () => kind,
      }),
    },
  }).mount(routes, { app: () => app, onError: createErrorHandler() });

  return {
    ran,
    request: () =>
      server.request(`/api/projects/${VERSION}/proj_1`, {
        headers: { authorization: "Bearer k" },
      }),
  };
}

describe("a REST route that names its project in its path", () => {
  describe("when a member who is not an admin opens an aggregate project", () => {
    /** @scenario "A non-admin on the aggregate's team is refused" */
    it("refuses as if no grant reached the project, and never runs the handler", async () => {
      const { ran, request } = mounted({ kind: "aggregate", organizationRole: "MEMBER" });

      const response = await request();

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        code: "permission_denied",
        meta: { denialReason: "no-grant" },
      });
      expect(ran).toEqual([]);
    });
  });

  describe("when an admin opens the aggregate project", () => {
    /** @scenario "A non-admin on the aggregate's team is refused" */
    it("serves it", async () => {
      const { ran, request } = mounted({ kind: "aggregate", organizationRole: "ADMIN" });

      expect((await request()).status).toBe(200);
      expect(ran).toEqual(["proj_1"]);
    });
  });

  describe("when the member opens an ordinary project", () => {
    /** @scenario "A non-admin on the aggregate's team is refused" */
    it("serves it", async () => {
      const { ran, request } = mounted({ kind: "application", organizationRole: "MEMBER" });

      expect((await request()).status).toBe(200);
      expect(ran).toEqual(["proj_1"]);
    });
  });
});
