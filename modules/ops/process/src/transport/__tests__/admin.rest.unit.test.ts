/** @vitest-environment node */
import { bindRestMiddleware, createRestRuntime } from "@langwatch/api/rest";
import type { OpsApi } from "@langwatch/ops-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { ErrorHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { adminActor, adminAuditRequest, adminAuthSession, adminRest } from "../admin.rest.ts";

const renderUnexpected: ErrorHandler = (error, context) =>
  context.json({ error: String(error) }, 500);

function mount(app: OpsApi) {
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => Promise.reject(new Error("public routes authenticate in-app")),
    },
  });

  return runtime.mount(adminRest.router(), {
    app: () => app,
    onError: renderUnexpected,
    facts: [
      bindRestMiddleware(adminActor, () => ({ id: "operator_1" })),
      bindRestMiddleware(adminAuthSession, () => ({ id: "session_1" })),
      bindRestMiddleware(adminAuditRequest, () => ({ headers: { "user-agent": "test" } })),
    ],
  });
}

describe("the admin REST declaration", () => {
  it("passes validated impersonation input and audit facts to one app operation", async () => {
    const startAdminImpersonation = vi.fn(async () => ({
      message: "Impersonation started" as const,
    }));
    const app = mount(createApiFixture<OpsApi>({ startAdminImpersonation }, "OpsApi"));

    const response = await app.request("/api/admin/impersonate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userIdToImpersonate: "user_2", reason: "support" }),
    });

    expect(response.status).toBe(200);
    expect(startAdminImpersonation).toHaveBeenCalledWith({
      userIdToImpersonate: "user_2",
      reason: "support",
      actor: { id: "operator_1" },
      session: { id: "session_1" },
      req: { headers: { "user-agent": "test" } },
    });
  });

  it("accepts the empty stop body through the declared parser", async () => {
    const stopAdminImpersonation = vi.fn(async () => ({
      message: "Impersonation ended" as const,
    }));
    const app = mount(createApiFixture<OpsApi>({ stopAdminImpersonation }, "OpsApi"));

    const response = await app.request("/api/admin/impersonate", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    expect(response.status).toBe(200);
    expect(stopAdminImpersonation).toHaveBeenCalledWith({
      actor: { id: "operator_1" },
      session: { id: "session_1" },
      req: { headers: { "user-agent": "test" } },
    });
  });
});
