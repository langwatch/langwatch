import { moduleApi } from "@langwatch/kernel";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { anyAuthenticated, publicRoute } from "../../access/access.ts";
import { MANAGEMENT_API_VERSION } from "../addressing.ts";
import { BearerIdentity } from "../bearer-identity.ts";
import { defineRestRouter } from "../declaration.ts";
import { RestHost } from "../host.ts";
import { bindRestCredential } from "../request.ts";
import type { RestIdentity } from "../runtime.ts";

const Api = moduleApi<{ read(): { ok: boolean } }>()("langy");
function family(namespace: string, path: string) {
  return defineRestRouter(Api)
    .withNamespace(namespace)
    .withVersion(MANAGEMENT_API_VERSION)
    .withAddressing("literal", { v1Twin: false })
    .withCredential("internalSecret")
    .get(path, namespace)
    .withAccess(anyAuthenticated({ reason: "module-owned internal credential" }))
    .withOutput(z.object({ ok: z.boolean() }))
    .handle(({ app }) => app.read())
    .build();
}
function host(browser?: RestIdentity) {
  const closed = BearerIdentity.create({ name: "unconfigured", token: void 0 });

  return RestHost.create({
    identities: {
      project: closed,
      organization: closed,
      apiKey: closed,
      scimToken: closed,
      "instance-admin": closed,
      browser: browser ?? closed,
    },
    bearers: () => closed,
    audit: { record: async () => {} },
  });
}
const app = () => ({ read: () => ({ ok: true }) });

describe("module credential bindings", () => {
  it("isolates each module's credential and leaves an unbound family closed", async () => {
    const server = host();

    for (const [namespace, token] of [
      ["first", "first-secret"],
      ["second", "second-secret"],
    ] as const) {
      server.mount(family(namespace, `/internal/${namespace}`).router(), app, {
        facts: [
          bindRestCredential("internalSecret", () =>
            BearerIdentity.create({ name: namespace, token }),
          ),
        ],
      });
    }

    server.mount(family("unbound", "/internal/unbound").router(), app);

    const allowed = await server.app.request("/internal/first", {
      headers: { authorization: "Bearer first-secret" },
    });

    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ ok: true });

    const denied = await server.app.request("/internal/second", {
      headers: { authorization: "Bearer first-secret" },
    });

    expect(denied.status).toBe(401);

    const missing = await server.app.request("/internal/unbound", {
      headers: { authorization: "Bearer first-secret" },
    });

    expect(missing.status).toBe(404);
  });

  it("refuses duplicate credential bindings before serving", () => {
    const binding = bindRestCredential("internalSecret", () =>
      BearerIdentity.create({ name: "test", token: "secret" }),
    );

    expect(() =>
      host().mount(family("duplicate", "/internal/duplicate").router(), app, {
        facts: [binding, binding],
      }),
    ).toThrow("binds internalSecret more than once");
  });
});

describe("declared request headers", () => {
  it("passes parsed headers separately and refuses invalid input before calling the application", async () => {
    const declaration = defineRestRouter(Api)
      .withNamespace("headers")
      .withVersion(MANAGEMENT_API_VERSION)
      .withAddressing("literal", { v1Twin: false })
      .get("/internal/headers", "readHeaders")
      .withAccess(publicRoute({ reason: "request parsing fixture" }))
      .withHeaders(z.object({ "x-count": z.coerce.number().int().positive() }))
      .withOutput(z.object({ ok: z.boolean(), count: z.number() }))
      .handle(({ app }, headers) => ({ ...app.read(), count: headers["x-count"] }))
      .build();

    const server = host();
    let calls = 0;

    server.mount(declaration.router(), () => ({
      read: () => {
        calls += 1;

        return { ok: true };
      },
    }));

    const accepted = await server.app.request("/internal/headers", { headers: { "x-count": "7" } });
    expect(await accepted.json()).toEqual({ ok: true, count: 7 });
    const refused = await server.app.request("/internal/headers", { headers: { "x-count": "-1" } });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ code: "validation_error" });
    expect(calls).toBe(1);
  });
});

describe("declared response metadata", () => {
  it("preserves revision headers and emits no body for 204 and 304", async () => {
    const declaration = defineRestRouter(Api)
      .withNamespace("conditional-answer")
      .withVersion(MANAGEMENT_API_VERSION)
      .withAddressing("literal", { v1Twin: false })
      .get("/internal/conditional", "conditionalAnswer")
      .withAccess(publicRoute({ reason: "conditional response fixture" }))
      .withQuery(z.object({ status: z.enum(["200", "204", "304"]) }))
      .responds({ 200: z.object({ ok: z.boolean() }), 204: z.object({}), 304: z.object({}) })
      .handle(({ app, input }) => {
        const headers = { "x-config-revision": "revision-7" };

        if (input.status === "204") return { status: 204, body: {}, headers };

        if (input.status === "304") return { status: 304, body: {}, headers };

        return { status: 200, body: app.read(), headers };
      })
      .build();

    const server = host();
    server.mount(declaration.router(), app);

    for (const status of [200, 204, 304]) {
      const response = await server.app.request(`/internal/conditional?status=${status}`);

      expect(response.status).toBe(status);
      expect(response.headers.get("x-config-revision")).toBe("revision-7");
      expect(await response.text()).toBe(status === 200 ? '{"ok":true}' : "");
    }
  });
});

describe("permission targets in declared headers", () => {
  it("authorizes the same parsed header the handler receives and refuses a different project", async () => {
    const seen: string[] = [];

    const authorize = vi.fn<NonNullable<RestIdentity["authorize"]>>(({ target }) => ({
      permitted: target.id === "allowed-project",
      organizationRole: null,
    }));

    const server = host({
      authenticate: () => ({ actor: null, scope: null }),
      identify: () => ({ actor: { type: "user", id: "user-1" }, scope: null }),
      authorize,
    });

    const declaration = defineRestRouter(Api)
      .withNamespace("header-permission")
      .withVersion(MANAGEMENT_API_VERSION)
      .withAddressing("literal", { v1Twin: false })
      .withCredential("browser")
      .post("/api/header-permission", "authorizeHeader")
      .withInput(z.object({ projectId: z.string() }))
      .withHeaders(z.object({ "x-project-id": z.string().trim().min(1) }))
      .withPermission("playground:view", {
        at: "header",
        param: "projectId",
        header: "x-project-id",
      })
      .withOutput(z.object({ ok: z.boolean() }))
      .handle(({ app }, headers) => {
        seen.push(headers["x-project-id"]);

        return app.read();
      })
      .build();

    server.mount(declaration.router(), app);

    const request = (projectId: string, bodyProject: string) =>
      server.app.request("/api/header-permission", {
        method: "POST",
        headers: { "content-type": "application/json", "x-project-id": projectId },
        body: JSON.stringify({ projectId: bodyProject }),
      });

    expect((await request("allowed-project", "other-project")).status).toBe(200);
    expect((await request("other-project", "allowed-project")).status).toBe(403);
    expect((await request(" ", "allowed-project")).status).toBe(422);
    expect(seen).toEqual(["allowed-project"]);

    expect(authorize).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        permission: "playground:view",
        target: { tier: "project", id: "allowed-project" },
      }),
    );

    expect(authorize).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        target: { tier: "project", id: "other-project" },
      }),
    );

    expect(authorize).toHaveBeenCalledTimes(2);
  });
});
