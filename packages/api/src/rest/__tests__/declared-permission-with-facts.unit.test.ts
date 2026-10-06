/**
 * A route that carries its own middleware still has its declared permission asked by the door.
 * Spec: specs/rbac/typed-permission-declarations.feature
 */
import { PermissionDeniedError, type AuthzPermission } from "@langwatch/authorization";
import { moduleApi } from "@langwatch/module";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createErrorHandler } from "../../errors.ts";
import type { RestCaller, RestIdentity } from "../../hosting/api-door.ts";
import { defineRestRouter } from "../declaration.ts";
import { bindRestMiddleware, defineRestMiddleware } from "../request.ts";
import { createRestRuntime } from "../runtime.ts";

const VERSION = "2026-10-05";
const CALLER: RestCaller = {
  actor: { type: "api_key", id: "key-1" },
  scope: { tier: "project", id: "project-1" },
};

interface DeskApi {
  open(input: { staff: string }): Promise<{ opened: string }>;
}

const DeskApi = moduleApi<DeskApi>()("ops");
const staff = defineRestMiddleware("staff", z.string());

function mounted({ refuses }: { refuses: readonly AuthzPermission[] }) {
  const authenticate = vi.fn(({ permission }: { permission: AuthzPermission }) => {
    if (refuses.includes(permission)) {
      throw new PermissionDeniedError({
        permission,
        scope: { type: "project", id: "project-1" },
        denialReason: "no-binding",
      });
    }

    return CALLER;
  });
  const identity = { authenticate } satisfies RestIdentity;
  const open = vi.fn(async ({ staff }: { staff: string }) => ({ opened: staff }));
  const readStaff = vi.fn(() => "ada");

  const declaration = defineRestRouter(DeskApi)
    .withNamespace("desk")
    .withVersion(VERSION)
    .withCredential("project")
    .get("/open", "openDesk")
    .withPermission("project:view")
    .withOutput(z.object({ opened: z.string() }))
    .withMiddleware(staff)
    .handle(({ app }, who) => app.open({ staff: who }))
    .build()
    .router();

  const hono = createRestRuntime({ identity }).mount(declaration, {
    app: () => ({ open }),
    onError: createErrorHandler(),
    facts: [bindRestMiddleware(staff, readStaff)],
  });

  return { authenticate, hono, open };
}

describe("a route that declares a permission and carries its own middleware", () => {
  describe("when the caller lacks the permission", () => {
    /** @scenario "An endpoint's middleware array cannot displace its declared check" */
    it("is refused permission_denied by the door, and the handler never runs", async () => {
      const { authenticate, hono, open } = mounted({ refuses: ["project:view"] });

      const response = await hono.request(`/api/desk/${VERSION}/open`);

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ code: "permission_denied" });
      expect(authenticate).toHaveBeenCalledWith(
        expect.objectContaining({ permission: "project:view" }),
      );
      expect(open).not.toHaveBeenCalled();
    });
  });

  describe("when the caller holds the permission", () => {
    /** @scenario "An endpoint's middleware array cannot displace its declared check" */
    it("is asked the declared permission, then hands the middleware's fact to the handler", async () => {
      const { authenticate, hono, open } = mounted({ refuses: [] });

      const response = await hono.request(`/api/desk/${VERSION}/open`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ opened: "ada" });
      expect(authenticate).toHaveBeenCalledWith(
        expect.objectContaining({ permission: "project:view" }),
      );
      expect(open).toHaveBeenCalledWith({ staff: "ada" });
    });
  });
});
