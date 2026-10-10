/** @vitest-environment node */

import { moduleApi } from "@langwatch/module";
import type * as Observability from "@langwatch/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { authorizationPort } from "../../__tests__/api-double.ts";
import { anyAuthenticated } from "../../access/access.ts";
import { MANAGEMENT_API_VERSION } from "../addressing.ts";
import { BearerIdentity } from "../bearer-identity.ts";
import { defineRestRouter } from "../declaration.ts";
import { RestHost } from "../host.ts";
import { bindRestCredential } from "../request.ts";

const logged = vi.hoisted(() => ({ errors: [] as string[] }));

vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<typeof Observability>();
  return {
    ...actual,
    createLogger: (name: string) => {
      const logger = actual.createLogger(name);
      if (name !== "langwatch:api:rest") return logger;
      return Object.assign(Object.create(logger), {
        error: (_fields: unknown, message: string) => logged.errors.push(message),
      });
    },
  };
});

const Api = moduleApi<{ read(): { ok: boolean } }>()("langy");
const declaration = defineRestRouter(Api)
  .withNamespace("internal")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .withCredential("internal_secret")
  .get("/internal/read", "internal")
  .withAccess(anyAuthenticated({ reason: "module-owned internal credential" }))
  .withOutput(z.object({ ok: z.boolean() }))
  .handle(({ app }) => app.read())
  .build();

function hostReading(read: () => { ok: boolean }) {
  const closed = BearerIdentity.create({ name: "unconfigured", token: void 0 });
  const host = RestHost.create({
    authz: authorizationPort.forRequest(),
    identities: {
      project: closed,
      organization: closed,
      api_key: closed,
      scim_token: closed,
      instance_admin: closed,
      browser: closed,
    },
    audit: { record: async () => {} },
  });
  host.mount(declaration.router(), () => ({ read }), {
    facts: [
      bindRestCredential("internal_secret", () =>
        BearerIdentity.create({ name: "internal", token: "internal-marker" }),
      ),
    ],
  });
  return host;
}

const headers = { authorization: "Bearer internal-marker" };

describe("a REST handler that fails", () => {
  beforeEach(() => {
    logged.errors.length = 0;
  });

  /** @scenario "A REST request the client aborted is not logged as a failure" */
  it("logs nothing when its client already aborted the request", async () => {
    const client = new AbortController();
    const host = hostReading(() => {
      client.abort();
      throw new DOMException("The operation was aborted.", "AbortError");
    });

    const response = await host.app.request("/internal/read", { headers, signal: client.signal });

    expect(response.status).toBe(500);
    expect(logged.errors).toEqual([]);
  });

  it("still logs a server fault on a request its client keeps open", async () => {
    const host = hostReading(() => {
      throw new Error("boom");
    });

    const response = await host.app.request("/internal/read", { headers });

    expect(response.status).toBe(500);
    expect(logged.errors).toEqual(["REST request failed"]);
  });
});
