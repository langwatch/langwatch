/**
 * A route on the key door declares how far its permission is asked, and the door answers it.
 * @see packages/api/specs/transport-declaration-split.feature
 */
import { PermissionDeniedError } from "@langwatch/authorization";
import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { RestIdentity } from "../../hosting/api-door.ts";
import { MANAGEMENT_API_VERSION } from "../addressing.ts";
import { defineRestRouter, type RestDoorCredential } from "../declaration.ts";
import { createRestRuntime } from "../runtime.ts";

const ORGANIZATION = { tier: "organization", id: "org-1" } as const;
const Api = moduleApi<{ read(): { ok: boolean } }>()("gateway");

function family(credential: RestDoorCredential) {
  return defineRestRouter(Api)
    .withNamespace("gateway")
    .withVersion(MANAGEMENT_API_VERSION)
    .withAddressing("literal", { v1Twin: false })
    .withCredential(credential)
    .get("/api/keys", "listKeys")
    .withPermission("virtualKeys:view", { at: "grants" })
    .withOutput(z.object({ ok: z.boolean() }))
    .handle(({ app }) => app.read())
    .post("/api/budgets", "createBudget")
    .withPermission("gatewayBudgets:create", { at: "organization" })
    .withOutput(z.object({ ok: z.boolean() }))
    .handle(({ app }) => app.read())
    .get("/api/budgets", "listBudgets")
    .withPermission("gatewayBudgets:view")
    .withOutput(z.object({ ok: z.boolean() }))
    .handle(({ app }) => app.read())
    .build();
}

/** A door that records each question and refuses the permissions the test withholds. */
function keyDoor(withheld: readonly string[] = []) {
  const asked: { permission: string; reach: string | undefined }[] = [];
  const door: RestIdentity = {
    authenticate: ({ permission, reach }) => {
      asked.push({ permission, reach });
      if (withheld.includes(permission)) {
        throw new PermissionDeniedError({
          permission,
          scope: { type: "organization", id: ORGANIZATION.id },
          denialReason: "no-binding",
        });
      }

      return { actor: { type: "user", id: "user-1" }, scope: ORGANIZATION };
    },
  };

  return { asked, door };
}

function mounted(door: RestIdentity, handled: string[] = []) {
  const runtime = createRestRuntime({ identity: door, doors: { api_key: door } });

  return runtime.mount(family("api_key").router(), {
    app: () => ({
      read: () => {
        handled.push("read");

        return { ok: true };
      },
    }),
    onError: (error, context) =>
      context.json({ code: (error as { code?: string }).code ?? "internal_error" }, 403),
  });
}

describe("a route that says how far the key door asks its permission", () => {
  /** @scenario "A route says how far the key door asks its permission" */
  it("asks the door with the reach each route declared, and with none where it declared none", async () => {
    const { asked, door } = keyDoor();
    const hono = mounted(door);

    await hono.request("/api/keys");
    await hono.request("/api/budgets", { method: "POST" });
    await hono.request("/api/budgets");

    expect(asked).toEqual([
      { permission: "virtualKeys:view", reach: "grants" },
      { permission: "gatewayBudgets:create", reach: "organization" },
      { permission: "gatewayBudgets:view", reach: void 0 },
    ]);
  });

  /** @scenario "A route says how far the key door asks its permission" */
  it("never reaches the handler for a caller the door refuses", async () => {
    const handled: string[] = [];
    const hono = mounted(keyDoor(["virtualKeys:view"]).door, handled);

    const response = await hono.request("/api/keys");

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "permission_denied" });
    expect(handled).toEqual([]);
  });

  /** @scenario "A route says how far the key door asks its permission" */
  it("refuses a mount that puts such a route behind another door, naming the route", () => {
    const { door } = keyDoor();
    const runtime = createRestRuntime({ identity: door });

    expect(() =>
      runtime.mount(family("organization").router(), {
        app: () => ({ read: () => ({ ok: true }) }),
        onError: (_error, context) => context.json({}, 500),
      }),
    ).toThrow(/GET \/api\/keys asks "virtualKeys:view" at the reach of a key's grants/);
  });
});
