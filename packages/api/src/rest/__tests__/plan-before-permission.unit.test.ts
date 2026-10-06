/**
 * A plan asked before the permission (Q31), and a `responds()` route writing its refusals in
 * its own wire. Specs: packages/api/specs/endpoint-capabilities.feature and
 * declared-response-kinds.feature.
 */
import type { AuthzPermission } from "@langwatch/authorization";
import { HandledError } from "@langwatch/handled-error";
import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { Entitlements } from "../../access/access.ts";
import { createErrorHandler } from "../../errors.ts";
import { CliTokenIdentity } from "../cli-token-identity.ts";
import { defineRestRouter } from "../declaration.ts";
import type { RestProtocolRefusal } from "../response-kind.ts";
import { createRestRuntime } from "../runtime.ts";

type SourcesApi = { list(): Promise<{ sources: string[] }> };

const SourcesApi = moduleApi<SourcesApi>()("governance");
const VERSION = "2026-10-06";
const BEARER = { authorization: "Bearer lw_at_live" };

const answers = {
  200: z.object({ sources: z.array(z.string()) }),
  402: z.object({ error: z.string(), error_description: z.string() }),
  403: z.object({ error: z.string(), error_description: z.string() }),
} as const;

/** Writes the plan and permission refusals as `{ error, error_description }`; declines the rest. */
const cliRefusal: RestProtocolRefusal = ({ failure, response }) => {
  if (!HandledError.isHandled(failure)) return response.decline();
  const error = { 402: "payment_required", 403: "forbidden" }[failure.httpStatus as 402 | 403];

  return error
    ? response.write({
        status: failure.httpStatus,
        mediaType: "application/json",
        body: JSON.stringify({ error, error_description: failure.message }),
      })
    : response.decline();
};

function world({ entitled, permitted }: { entitled: boolean; permitted: boolean }) {
  const asked: string[] = [];
  const door = CliTokenIdentity.create({
    verify: async () => {
      asked.push("identify");

      return { userId: "user-1", organizationId: "org-1" };
    },
    permitted: ({ permission, scope }) => {
      asked.push(`permission ${permission} at ${scope.tier}:${scope.id}`);

      return { permitted, organizationRole: null };
    },
  });
  const entitlements: Entitlements = {
    holds: async ({ entitlement, scope }) => {
      asked.push(`plan ${entitlement} at ${scope.tier}:${scope.id}`);

      return entitled;
    },
  };

  return { asked, door, entitlements };
}

function router(options: { refusal?: RestProtocolRefusal; ran?: string[] } = {}) {
  return defineRestRouter(SourcesApi)
    .withNamespace("q31-sources")
    .withVersion(VERSION)
    .withCredential("cli_token")
    .get("/", "list")
    .withPermission("ingestionSources:view")
    .withEntitlement("enterprise", { feature: "INGESTION_SOURCES", before: "permission" })
    .responds(answers, options.refusal ? { refusal: options.refusal } : {})
    .handle(() => {
      options.ran?.push("list");

      return { status: 200 as const, body: { sources: ["source-1"] } };
    })
    .build()
    .router();
}

function mount(
  routes: ReturnType<typeof router>,
  { door, entitlements }: Pick<ReturnType<typeof world>, "door" | "entitlements">,
) {
  return createRestRuntime({ identity: door, doors: { cli_token: door }, entitlements }).mount(
    routes,
    { app: () => ({ list: async () => ({ sources: [] }) }), onError: createErrorHandler() },
  );
}

describe("a route that asks its plan before its permission", () => {
  /** @scenario "An endpoint asks its plan before its permission" */
  it("identifies, asks the plan at the credential's scope, then the permission", async () => {
    const ran: string[] = [];
    const given = world({ entitled: true, permitted: true });

    const response = await mount(router({ ran }), given).request(`/api/q31-sources/${VERSION}/`, {
      headers: BEARER,
    });

    expect(response.status).toBe(200);
    expect(given.asked).toEqual([
      "identify",
      "plan enterprise at organization:org-1",
      "permission ingestionSources:view at organization:org-1",
    ]);
    expect(ran).toEqual(["list"]);
  });

  /** @scenario "An endpoint asks its plan before its permission" */
  it("answers the plan refusal to an unentitled caller the permission would refuse too", async () => {
    const ran: string[] = [];
    const given = world({ entitled: false, permitted: false });

    const response = await mount(router({ ran }), given).request(`/api/q31-sources/${VERSION}/`, {
      headers: BEARER,
    });

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({ code: "enterprise_plan_required" });
    expect(given.asked).toEqual(["identify", "plan enterprise at organization:org-1"]);
    expect(ran).toEqual([]);
  });

  /** @scenario "An endpoint asks its plan before its permission" */
  it("answers the permission refusal to an entitled caller without the permission", async () => {
    const given = world({ entitled: true, permitted: false });

    const response = await mount(router(), given).request(`/api/q31-sources/${VERSION}/`, {
      headers: BEARER,
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "permission_denied" });
  });

  /** @scenario "An endpoint asks its plan before its permission" */
  it("refuses, where it is written, a plan first whose permission is asked elsewhere", () => {
    const askedAtPath = (permission: AuthzPermission) => () =>
      defineRestRouter(SourcesApi)
        .withNamespace("q31-elsewhere")
        .withVersion(VERSION)
        .withCredential("cli_token")
        .get("/:projectId", "list")
        .withParams(z.object({ projectId: z.string() }))
        .withPermission(permission, { at: "route", param: "projectId" })
        .withEntitlement("enterprise", { before: "permission" })
        .responds(answers)
        .handle(() => ({ status: 200 as const, body: { sources: [] } }))
        .build();

    expect(askedAtPath("traces:view")).toThrow(/asked at the credential's own scope/);
  });
});

describe("a route with declared answers and a refusal of its own", () => {
  /** @scenario "A route with declared answers writes its refusals in a wire it keeps" */
  it("writes the plan and permission refusals in the route's wire", async () => {
    const unentitled = world({ entitled: false, permitted: false });
    const unpermitted = world({ entitled: true, permitted: false });
    const route = router({ refusal: cliRefusal });

    const plan = await mount(route, unentitled).request(`/api/q31-sources/${VERSION}/`, {
      headers: BEARER,
    });
    const permission = await mount(route, unpermitted).request(`/api/q31-sources/${VERSION}/`, {
      headers: BEARER,
    });

    expect(plan.status).toBe(402);
    await expect(plan.json()).resolves.toEqual({
      error: "payment_required",
      error_description: expect.any(String),
    });
    expect(permission.status).toBe(403);
    await expect(permission.json()).resolves.toMatchObject({ error: "forbidden" });
  });

  /** @scenario "A route with declared answers writes its refusals in a wire it keeps" */
  it("leaves a refusal it declines to the family's boundary", async () => {
    const response = await mount(
      router({ refusal: cliRefusal }),
      world({ entitled: true, permitted: true }),
    ).request(`/api/q31-sources/${VERSION}/`);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "missing_credentials" });
  });
});
