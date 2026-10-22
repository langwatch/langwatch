/** @vitest-environment node */

import type { Actor } from "@langwatch/authorization";
import { moduleApi } from "@langwatch/module";
import type * as Observability from "@langwatch/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { authorizationPort } from "../../__tests__/api-double.ts";
import { anyAuthenticated } from "../../access/access.ts";
import type { RestCaller, RestIdentity } from "../../hosting/api-door.ts";
import { ClientAddress } from "../../policy/client-address.ts";
import { MANAGEMENT_API_VERSION } from "../addressing.ts";
import { BearerIdentity } from "../bearer-identity.ts";
import { defineRestRouter } from "../declaration.ts";
import { RestHost } from "../host.ts";
import { principalOf, requestPrincipalLogFields } from "../request-principal.ts";
import { bindRestCredential } from "../request.ts";

const records = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<typeof Observability>();
  return {
    ...actual,
    createLogger: (name: string) => {
      const logger = actual.createLogger(name);
      if (name !== actual.REQUEST_LOGGER_NAME) return logger;
      const capture = (fields: Record<string, unknown>) => records.push(fields);
      return Object.assign(Object.create(logger), { info: capture, warn: capture, error: capture });
    },
  };
});

const SECRET = "sk-lw-never-logged-secret-value";

const Api = moduleApi<{ read(): { ok: boolean } }>()("langy");
const declaration = defineRestRouter(Api)
  .withNamespace("internal")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .withCredential("internal_secret")
  .get("/internal/read", "internal")
  .withAccess(anyAuthenticated({ reason: "a door that names its caller" }))
  .withOutput(z.object({ ok: z.boolean() }))
  .handle(({ app }) => app.read())
  .build();

function hostCalledBy(actor: Actor | null) {
  const caller: RestCaller = {
    actor,
    scope: null,
    internal: { type: "internalSecret", secretName: "TEST_DOOR_SECRET" },
  };
  const door: RestIdentity = { authenticate: () => caller, identify: () => caller };
  const closed = BearerIdentity.create({ name: "unconfigured", token: void 0 });
  const host = RestHost.create({
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
  host.mount(declaration.router(), () => ({ read: () => ({ ok: true }) }), {
    middlewareBindings: [bindRestCredential("internal_secret", () => door)],
  });
  return host;
}

function arrivingFrom(socketAddress: string): Request {
  const request = new Request("http://localhost/internal/read", {
    headers: { authorization: `Bearer ${SECRET}` },
  });
  ClientAddress.classifyByAddress().handle({ request, socketAddress });
  return request;
}

describe("the request access record", () => {
  beforeEach(() => {
    records.length = 0;
  });

  describe("when a signed-in user's request is answered", () => {
    /** @scenario "The request log names the client address" */
    /** @scenario "The request log names the user behind a session" */
    it("carries the client address and the user id, and nothing of the credential", async () => {
      const host = hostCalledBy({ type: "user", id: "user_123" });

      const response = await host.app.request(arrivingFrom("198.51.100.7"));

      expect(response.status).toBe(200);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ "client.address": "198.51.100.7", "user.id": "user_123" });
      expect(JSON.stringify(records[0])).not.toContain(SECRET);
    });
  });

  describe("when a request with no resolved address or caller is answered", () => {
    it("leaves the address and principal fields out rather than failing", async () => {
      const host = hostCalledBy(null);

      const response = await host.app.request(
        new Request("http://localhost/internal/read", {
          headers: { authorization: `Bearer ${SECRET}` },
        }),
      );

      expect(response.status).toBe(200);
      expect(records[0]).not.toHaveProperty("client.address");
      expect(records[0]).not.toHaveProperty("user.id");
    });
  });
});

describe("principalOf", () => {
  describe("when the door resolved an API key", () => {
    /** @scenario "The request log names the API key and its kind, never the key" */
    it("names the key id and its kind", () => {
      const principal = principalOf({
        actor: { type: "api_key", id: "key_1" },
        key: { kind: "api_key", apiKeyId: "key_1", ownerUserId: null },
      });

      expect(requestPrincipalLogFields({ principal, clientAddress: void 0 })).toEqual({
        "api_key.id": "key_1",
        "api_key.type": "api_key",
      });
    });

    it("names the user a personal key acts as beside the key", () => {
      const principal = principalOf({
        actor: { type: "user", id: "user_9" },
        key: { kind: "ingestion_key", apiKeyId: "key_2", ownerUserId: "user_9" },
      });

      expect(principal).toEqual({
        userId: "user_9",
        apiKeyId: "key_2",
        apiKeyType: "ingestion_key",
      });
    });

    it("names the kind of a key that carries no id", () => {
      const principal = principalOf({
        actor: null,
        key: { kind: "legacy_project_key", apiKeyId: null, ownerUserId: null },
      });

      expect(principal).toEqual({ apiKeyType: "legacy_project_key" });
    });
  });

  describe("when nobody called", () => {
    /** @scenario "A request with no caller names no principal" */
    it("names no user, no key and no kind", () => {
      const principal = principalOf({ actor: null, key: null });

      expect(requestPrincipalLogFields({ principal, clientAddress: void 0 })).toEqual({});
    });

    it("names nobody for a system or internal actor", () => {
      expect(principalOf({ actor: { type: "internal", codePath: "tests" }, key: null })).toEqual(
        {},
      );
    });
  });
});
