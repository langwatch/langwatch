/**
 * The REST door refuses a write under an aggregate as the tRPC door does (ADR-177 decision 8).
 * Spec: specs/governance/aggregate-project.feature.
 */
import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { authorizeDefaults } from "../../__tests__/api-double.ts";
import type { Authorize } from "../../access/access.ts";
import { createErrorHandler } from "../../errors.ts";
import type { RestIdentity } from "../../hosting/api-door.ts";
import { defineRestRouter } from "../declaration.ts";
import { createRestRuntime } from "../runtime.ts";

type RunsApi = { run(): Promise<{ ran: boolean }> };

const RunsApi = moduleApi<RunsApi>()("experiment");
const VERSION = "2026-10-09";

function mounted({ kind }: { kind: string }) {
  const ran: string[] = [];
  const door: RestIdentity = {
    authenticate: () => ({
      actor: { type: "user", id: "user_sam" },
      scope: { tier: "project", id: "proj_1" },
    }),
  };
  const authorize: Authorize = {
    ...authorizeDefaults,
    getDecision: async () => ({ permitted: true, organizationRole: "ADMIN" }),
    getProjectAnyDecision: async () => ({ permitted: true, organizationRole: "ADMIN" }),
    checkScopeLineage: async () => ({ kind: "consistent" }),
    organizationOf: async () => "org_acme",
    projectKindOf: async () => kind,
  };
  const routes = defineRestRouter(RunsApi)
    .withNamespace("runs")
    .withVersion(VERSION)
    .post("/", "execute")
    .withPermission("evaluations:manage")
    .withOutput(z.object({ ran: z.boolean() }))
    .handle(({ app }) => app.run())
    .get("/", "list")
    .withPermission("evaluations:view")
    .withOutput(z.object({ ran: z.boolean() }))
    .handle(({ app }) => app.run())
    .build()
    .router();
  const app: RunsApi = {
    run: async () => {
      ran.push("run");

      return { ran: true };
    },
  };
  const server = createRestRuntime({
    identity: door,
    authorization: { forRequest: () => authorize },
  }).mount(routes, { app: () => app, onError: createErrorHandler() });

  return {
    ran,
    request: (method: "GET" | "POST") =>
      server.request(`/api/runs/${VERSION}/`, { method, headers: { authorization: "Bearer k" } }),
  };
}

describe("a REST route on an aggregate project", () => {
  describe("when the request writes under a permission that writes under the project", () => {
    it("refuses it as read only and never runs the handler", async () => {
      const { ran, request } = mounted({ kind: "aggregate" });

      const response = await request("POST");

      expect(response.status).toBe(403);
      expect(await response.text()).toContain("aggregate_project_is_read_only");
      expect(ran).toEqual([]);
    });

    it("runs it on an ordinary project", async () => {
      const { ran, request } = mounted({ kind: "application" });

      expect((await request("POST")).status).toBe(200);
      expect(ran).toEqual(["run"]);
    });
  });

  describe("when the request reads", () => {
    it("runs it on the aggregate", async () => {
      const { ran, request } = mounted({ kind: "aggregate" });

      expect((await request("GET")).status).toBe(200);
      expect(ran).toEqual(["run"]);
    });
  });
});
