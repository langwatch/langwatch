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

const records = vi.hoisted(() => [] as { logger: string; fields: Record<string, unknown> }[]);

vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<typeof Observability>();
  return {
    ...actual,
    createLogger: (name: string) => {
      const logger = actual.createLogger(name);
      return Object.assign(Object.create(logger), {
        info: (fields: Record<string, unknown>, message: string) => {
          if (message === "request handled") records.push({ logger: name, fields });
        },
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

function host() {
  const closed = BearerIdentity.create({ name: "unconfigured", token: void 0 });
  const rest = RestHost.create({
    authz: authorizationPort.forRequest(),
    identities: {
      project: closed,
      organization: closed,
      api_key: closed,
      instance_admin: closed,
      browser: closed,
    },
    audit: { record: async () => {} },
  });
  rest.mount(declaration.router(), () => ({ read: () => ({ ok: true }) }), {
    middlewareBindings: [
      bindRestCredential("internal_secret", () =>
        BearerIdentity.create({ name: "internal", token: "internal-marker" }),
      ),
    ],
  });
  return rest;
}

describe("the REST request log", () => {
  beforeEach(() => {
    records.length = 0;
  });

  describe("when a family with its own namespace answers a request", () => {
    /** @scenario "Every API family's request record is written under one logger name" */
    it("writes the record under langwatch:api:hono and carries the family as a field", async () => {
      const response = await host().app.request("/internal/read", {
        headers: { authorization: "Bearer internal-marker" },
      });

      expect(response.status).toBe(200);
      expect(records).toEqual([
        expect.objectContaining({
          logger: "langwatch:api:hono",
          fields: expect.objectContaining({ family: "internal", statusCode: 200 }),
        }),
      ]);
    });
  });
});
