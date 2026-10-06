/**
 * @vitest-environment node
 * `/api/admin/*` behind the browser door, asked at the platform tier with main's hidden 404
 * (ARCHITECTURE.md §8, E4): refused before the body is read, then one app operation.
 */
import { createErrorHandler } from "@langwatch/api";
import { SessionReader, type SessionCaller } from "@langwatch/api/hosting";
import { bindRestMiddleware, BrowserSessionIdentity, createRestRuntime } from "@langwatch/api/rest";
import { AdminSurfaceHiddenError, type OpsApi } from "@langwatch/ops-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createOpsTestApp, platformOperatorAuthz } from "../../app/__tests__/ops.fixture.ts";
import { adminAuditRequest, adminAuthSession, adminRest } from "../admin.rest.ts";

const SAME_SITE = { "content-type": "application/json", "sec-fetch-site": "same-origin" };
const SESSIONS: Record<string, SessionCaller> = {
  manager: { userId: "operator_1" },
  viewer: { userId: "viewer_1" },
  customer: { userId: "customer_1" },
  impersonating: { userId: "customer_1", impersonator: { id: "operator_1" } },
};
const GRANTS: Record<string, readonly string[]> = {
  operator_1: ["ops:view", "ops:manage"],
  viewer_1: ["ops:view"],
};

/** Main's hidden answer: the error its `adminActor` middleware threw, rendered alike. */
async function mainsHiddenAnswer(): Promise<{ status: number; body: string }> {
  const main = new Hono().onError(createErrorHandler());
  main.get("/", () => {
    throw new AdminSurfaceHiddenError();
  });
  const response = await main.request("/");

  return { status: response.status, body: await response.text() };
}

function mount(app: OpsApi) {
  const door = BrowserSessionIdentity.create({
    sessions: SessionReader.create({
      verify: async (request: Request) => SESSIONS[request.headers.get("cookie") ?? ""] ?? null,
    }),
    authz: {
      getDecision: async () => ({ permitted: false, organizationRole: null }),
      getPlatformDecision: async ({ userId, permission }) => ({
        permitted: (GRANTS[userId] ?? []).includes(permission),
      }),
    },
    publicBaseUrl: void 0,
  });

  return createRestRuntime({ identity: door, doors: { browser: door } }).mount(adminRest.router(), {
    app: () => app,
    onError: createErrorHandler(),
    facts: [
      bindRestMiddleware(adminAuthSession, () => ({ id: "session_1" })),
      bindRestMiddleware(adminAuditRequest, () => ({ headers: { "user-agent": "test" } })),
    ],
  });
}

function request(cookie: string | null, method: string, path: string, body: string) {
  return {
    path,
    init: { method, headers: cookie ? { ...SAME_SITE, cookie } : SAME_SITE, body },
  };
}

describe("the admin REST declaration", () => {
  describe("given a caller the platform door refuses", () => {
    /** @scenario "Instance admin answers a refused caller the hidden 404 at its door" */
    it.each([
      ["no session", null, "POST", "/api/admin/impersonate"],
      ["a customer", "customer", "POST", "/api/admin/impersonate"],
      ["a view-only operator", "viewer", "DELETE", "/api/admin/impersonate"],
      ["a customer", "customer", "POST", "/api/admin/user"],
    ])(
      "answers %s main's hidden 404 before the body is read",
      async (_who, cookie, method, path) => {
        const app = createApiFixture<OpsApi>({}, "OpsApi");
        const { init } = request(cookie, method, path, "{not json");

        const response = await mount(app).request(path, init);

        expect({ status: response.status, body: await response.text() }).toEqual(
          await mainsHiddenAnswer(),
        );
        expect(response.status).toBe(404);
      },
    );
  });

  describe("given an operator holding ops:manage", () => {
    it("passes validated impersonation input and audit facts to one app operation", async () => {
      const startAdminImpersonation = vi.fn(async () => ({
        message: "Impersonation started" as const,
      }));
      const app = mount(createApiFixture<OpsApi>({ startAdminImpersonation }, "OpsApi"));
      const body = JSON.stringify({ userIdToImpersonate: "user_2", reason: "support" });
      const { path, init } = request("manager", "POST", "/api/admin/impersonate", body);

      const response = await app.request(path, init);

      expect(response.status).toBe(200);
      expect(startAdminImpersonation).toHaveBeenCalledWith({
        userIdToImpersonate: "user_2",
        reason: "support",
        actor: { id: "operator_1" },
        session: { id: "session_1" },
        req: { headers: { "user-agent": "test" } },
      });
    });

    it("hands an impersonating operator's stop the impersonator beside the session's user", async () => {
      const stopAdminImpersonation = vi.fn(async () => ({
        message: "Impersonation ended" as const,
      }));
      const app = mount(createApiFixture<OpsApi>({ stopAdminImpersonation }, "OpsApi"));
      const { path, init } = request("impersonating", "DELETE", "/api/admin/impersonate", "{}");

      const response = await app.request(path, init);

      expect(response.status).toBe(200);
      expect(stopAdminImpersonation).toHaveBeenCalledWith({
        actor: { id: "customer_1", impersonator: { id: "operator_1" } },
        session: { id: "session_1" },
        req: { headers: { "user-agent": "test" } },
      });
    });
  });

  describe("given a member of instance staff reading what the console lists", () => {
    const RESOURCES = ["user", "organization", "project", "subscription"] as const;
    const { app: operatorApp } = createOpsTestApp({
      authz: platformOperatorAuthz({ holders: { viewer_1: ["ops:view"] } }),
      capability: {
        adminOperation: async (input) => ({
          data: [{ id: `${input.resource}_1` }],
          total: 1,
        }),
      },
    });

    /** @scenario "Every instance admin resource the console lists answers" */
    it.each(
      RESOURCES.flatMap((resource) => [
        [resource, `/api/admin/${resource}`],
        [resource, `/api/v1/admin/${resource}`],
      ]),
    )("answers the %s list at %s", async (resource, path) => {
      const { init } = request(
        "viewer",
        "POST",
        path,
        JSON.stringify({ method: "getList", params: {} }),
      );

      const response = await mount(operatorApp).request(path, init);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ data: [{ id: `${resource}_1` }], total: 1 });
    });
  });

  describe("given a view-only operator reading a resource", () => {
    it("admits the read at the door and hands the method to the application", async () => {
      const runAdminOperation = vi.fn(async () => ({ data: [], total: 0 }));
      const app = mount(createApiFixture<OpsApi>({ runAdminOperation }, "OpsApi"));
      const body = JSON.stringify({ method: "getList", params: {} });
      const { path, init } = request("viewer", "POST", "/api/admin/user", body);

      const response = await app.request(path, init);

      expect(response.status).toBe(200);
      expect(runAdminOperation).toHaveBeenCalledWith(
        expect.objectContaining({ resource: "user", method: "getList", actor: { id: "viewer_1" } }),
      );
    });
  });
});
