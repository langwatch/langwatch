/** @vitest-environment node */
/** A raw JSON body names the project its permission is asked at (transport-conventions.feature). */
import { moduleApi } from "@langwatch/module";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { authorizeDefaults } from "../../__tests__/api-double.ts";
import type { Authorize } from "../../access/access.ts";
import { createErrorHandler, SurfaceUnverifiedError } from "../../errors.ts";
import { defineRestRouter } from "../declaration.ts";
import { createRestRuntime } from "../runtime.ts";

type EventsApi = { post(input: { raw: string }): Promise<{ ran: boolean }> };

const EventsApi = moduleApi<EventsApi>()("workflow");

function mounted({ signedIn = true, granted = true, kind = "application" } = {}) {
  const post = vi.fn(async (_input: { raw: string }) => ({ ran: true }));
  const authorizeDoor = vi.fn(() => ({ permitted: granted, organizationRole: "ADMIN" as const }));
  const authorize: Authorize = {
    ...authorizeDefaults,
    getDecision: async () => ({ permitted: true, organizationRole: "ADMIN" }),
    getProjectAnyDecision: async () => ({ permitted: true, organizationRole: "ADMIN" }),
    checkScopeLineage: async () => ({ kind: "consistent" }),
    organizationOf: async () => "org_acme",
    projectKindOf: async () => kind,
  };
  const routes = defineRestRouter(EventsApi)
    .withNamespace("events")
    .withVersion("2026-10-09")
    .withCredential("browser")
    .withAddressing("literal", { v1Twin: false })
    .post("/api/events", "post")
    .withRawBody("text", { mediaType: "application/json" })
    .withPermission("workflows:manage", {
      at: "body",
      param: "projectId",
      schema: z.object({ projectId: z.string() }),
    })
    .withOutput(z.object({ ran: z.boolean() }))
    .withoutAudit("test route")
    .handle(({ app, raw }) => app.post({ raw: String(raw) }))
    .build()
    .router();
  const server = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("a browser route never authenticates a key");
      },
      identify: () => {
        if (!signedIn) throw new SurfaceUnverifiedError("browser");

        return { actor: { type: "user", id: "user_1" }, scope: null };
      },
      authorize: authorizeDoor,
    },
    authorization: { forRequest: () => authorize },
  }).mount(routes, { app: () => ({ post }), credential: "browser", onError: createErrorHandler() });

  return {
    post,
    authorizeDoor,
    send: (body: string) =>
      server.request("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
  };
}

const naming = JSON.stringify({ projectId: "project_1", extra: { kept: true } });

describe("a raw-body route that asks its permission at the project its body names", () => {
  /** @scenario "A raw-body route asks its permission at the project its body names" */
  it("asks at that project and hands the handler the raw body unchanged", async () => {
    const { post, authorizeDoor, send } = mounted();

    expect((await send(naming)).status).toBe(200);
    expect(authorizeDoor).toHaveBeenCalledWith(
      expect.objectContaining({
        permission: "workflows:manage",
        target: expect.objectContaining({ tier: "project", id: "project_1" }),
      }),
    );
    expect(post).toHaveBeenCalledWith({ raw: naming });
  });

  /** @scenario "A raw-body route asks its permission at the project its body names" */
  it("refuses malformed JSON 400 and a body naming no project 422, asking nothing", async () => {
    const { post, authorizeDoor, send } = mounted();

    const malformed = await send("{not json");
    const unnamed = await send(JSON.stringify({ other: 1 }));

    expect(malformed.status).toBe(400);
    expect(await malformed.text()).toContain("malformed_request");
    expect(unnamed.status).toBe(422);
    expect(await unnamed.text()).toContain("validation_error");
    expect(authorizeDoor).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  /** @scenario "A raw-body route asks its permission at the project its body names" */
  it("refuses a caller with no session 401 and one without the permission 403", async () => {
    const anonymous = mounted({ signedIn: false });
    const refused = mounted({ granted: false });

    expect((await anonymous.send("{not json")).status).toBe(401);
    expect((await refused.send(naming)).status).toBe(403);
    expect(anonymous.post).not.toHaveBeenCalled();
    expect(refused.post).not.toHaveBeenCalled();
  });

  /** @scenario "A raw-body route refuses a write under an aggregate project its body names" */
  it("refuses a write to an aggregate project as read only", async () => {
    const { post, send } = mounted({ kind: "aggregate" });

    const response = await send(naming);

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("aggregate_project_is_read_only");
    expect(post).not.toHaveBeenCalled();
  });
});
