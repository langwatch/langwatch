/**
 * `/api/admin/*` through the real Hono app the API process mounts —
 * `runtime.mount` over the ops module's own application, with the two
 * browser-session facts (`adminActor`, `adminAuthSession`) bound by this
 * process's own session read.
 */
// @vitest-environment node
import type { OpsApi, OpsOperator } from "@langwatch/ops-contract";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { ApiRestObservabilityComposition } from "../../../app/api-rest-observability.composition.ts";
import { createApiRestRuntime } from "../../../app-rest/api-rest.runtime.ts";
import { mountAdminRest } from "../admin-rest.mount.ts";

const STAFF: OpsOperator = { id: "user_1", email: "staff@langwatch.ai" };

describe("given the back office's session facts", () => {
  describe("when a signed-in staff member starts an impersonation", () => {
    it("resolves the actor and the auth session as bound facts and calls the app", async () => {
      const startImpersonation = vi.fn(async () => {});
      const admitBackOfficeStaff = vi.fn(() => STAFF);
      const world = mount({ admitBackOfficeStaff, startImpersonation, actor: STAFF, authSessionId: "sess_1" });

      const response = await world.send("/api/admin/impersonate", {
        method: "POST",
        body: { userIdToImpersonate: "user_2", reason: "support ticket #1" },
      });

      expect(response.status).toBe(200);
      expect(startImpersonation).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "sess_1",
          impersonatorUserId: "user_1",
          userIdToImpersonate: "user_2",
          reason: "support ticket #1",
        }),
      );
    });
  });

  describe("when nobody is signed in", () => {
    it("resolves the actor fact as null and lets the app's own back-office refusal answer", async () => {
      const admitBackOfficeStaff = vi.fn(() => {
        throw new Error("not staff");
      });
      const world = mount({ admitBackOfficeStaff, actor: null, authSessionId: null });

      const response = await world.send("/api/admin/impersonate", {
        method: "POST",
        body: { userIdToImpersonate: "user_2", reason: "x" },
      });

      expect(admitBackOfficeStaff).toHaveBeenCalledWith(null);
      expect(response.status).toBe(500);
    });
  });

  describe("when a back-office resource operation is run", () => {
    it("resolves only the actor fact, not the raw auth session", async () => {
      const adminOperation = vi.fn(async () => ({ data: [] }));
      const admitBackOfficeStaff = vi.fn(() => STAFF);
      const world = mount({ admitBackOfficeStaff, adminOperation, actor: STAFF, authSessionId: "sess_1" });

      const response = await world.send("/api/admin/organizations", {
        method: "POST",
        body: { method: "getList", params: {} },
      });

      expect(response.status).toBe(200);
      expect(adminOperation).toHaveBeenCalledWith(
        expect.objectContaining({ resource: "organization", actorId: "user_1" }),
      );
    });
  });
});

// ---------------------------------------------------------------------------

function mount(overrides: {
  admitBackOfficeStaff: OpsApi["admitBackOfficeStaff"];
  startImpersonation?: OpsApi["startImpersonation"];
  adminOperation?: OpsApi["adminOperation"];
  actor: OpsOperator | null;
  authSessionId: string | null;
}) {
  const errors = ApiRestObservabilityComposition.create().legacyErrorHandler;
  const runtime = createApiRestRuntime({
    projectCredential: () => {
      throw new Error("This door resolves no project credential of its own.");
    },
    organizationCredential: () => {
      throw new Error("This door resolves no organization credential of its own.");
    },
    organizationIdentity: () => {
      throw new Error("This door resolves no organization credential of its own.");
    },
    routeAuthorization: () => {
      throw new Error("This suite authorizes no route-scoped permission.");
    },
    errors,
  });

  const ops = {
    admitBackOfficeStaff: overrides.admitBackOfficeStaff,
    startImpersonation: overrides.startImpersonation ?? vi.fn(async () => {}),
    stopImpersonation: vi.fn(async () => {}),
    adminOperation: overrides.adminOperation ?? vi.fn(async () => ({})),
  } as OpsApi;

  const mounted = mountAdminRest(runtime, {
    ops: () => ops,
    resolveActor: async () => overrides.actor,
    resolveAuthSession: async () =>
      overrides.authSessionId === null ? null : { id: overrides.authSessionId },
  });
  const hono = new Hono().route("/", mounted);

  return {
    send: (path: string, init: { method?: string; body?: unknown } = {}) =>
      hono.fetch(
        new Request(`http://api.test${path}`, {
          method: init.method ?? "GET",
          headers: { "Content-Type": "application/json" },
          ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        }),
      ),
  };
}
