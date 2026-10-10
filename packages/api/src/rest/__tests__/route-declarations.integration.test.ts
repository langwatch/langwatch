/**
 * The two cross-cutting concerns a ROUTE declares for itself: the credential kind it answers
 * behind, and the trail it leaves. Both are fulfilled by the runtime, so the app carries neither.
 * Spec: specs/server/declarative-process-composition.feature.
 */

import { moduleApi } from "@langwatch/module";
import type { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { authorizationPort } from "../../__tests__/api-double.ts";
import { createErrorHandler, EndpointWithdrawnError } from "../../errors.ts";
import type { RestAuditRow, RestIdentity } from "../../hosting/api-door.ts";
import { ClientAddress } from "../../policy/client-address.ts";
import { recordOrganizationCredential } from "../credential.ts";
import { defineRestRouter } from "../declaration.ts";
import { createRestRuntime, type RestRuntimeMembers } from "../runtime.ts";

const VERSION = "2026-09-10";

interface KeyApi {
  create(input: { name: string }): Promise<{ id: string }>;
  read(input: { id: string }): Promise<{ id: string; door: string }>;
  withdraw(input: { id: string }): Promise<{ id: string }>;
}

const KeyApi = moduleApi<KeyApi>()("api-key");

const application: KeyApi = {
  create: async ({ name }) => ({ id: `key-${name}` }),
  read: async ({ id }) => ({ id, door: "read" }),
  withdraw: async () => {
    throw new EndpointWithdrawnError();
  },
};

/**
 * The identity the create and read handlers below observed, for the
 * dispatching test to assert on — a handler runs outside the test's own body.
 */
let createHandlerSawIdentity: { actor: unknown; scope: unknown } | undefined;
let readHandlerSawScope: unknown;

/**
 * The family answers behind an organization credential; its create raises the
 * instance administrator's door for itself, and both writes leave a trail.
 */
const keys = defineRestRouter(KeyApi)
  .withNamespace("api-keys")
  .withVersion(VERSION)
  .withCredential("organization")

  .post("/", "createApiKey")
  .withCredential("instance_admin")
  .withAudit("api-key.created")
  .withInput(z.object({ name: z.string() }))
  .withPermission("organization:manage")
  .withOutput(z.object({ id: z.string() }))
  .handle(async ({ app, input, actor, scope }) => {
    createHandlerSawIdentity = { actor, scope };

    return app.create({ name: input.name });
  })

  .get("/:id", "getApiKey")
  .withParams(z.object({ id: z.string() }))
  .withPermission("organization:view")
  .withOutput(z.object({ id: z.string(), door: z.string() }))
  .handle(async ({ app, input, scope }) => {
    readHandlerSawScope = scope;

    return app.read({ id: input.id });
  })

  .delete("/:id", "deleteApiKey")
  .withParams(z.object({ id: z.string() }))
  .withAudit("api-key.deleted")
  .withPermission("organization:manage")
  .withOutput(z.object({ id: z.string() }))
  .handle(async ({ app, input }) => app.withdraw({ id: input.id }))
  .build();

const organizationDoor: RestIdentity = {
  authenticate: () => ({
    actor: { type: "user", id: "user-1" },
    scope: { tier: "organization", id: "organization-1" },
  }),
};

/** The instance administrator's bearer names no tenant and nobody inside one. */
const instanceAdminDoor: RestIdentity = {
  authenticate: () => ({ actor: null, scope: null }),
};

function recordingSink(): { rows: RestAuditRow[]; record(row: RestAuditRow): void } {
  const rows: RestAuditRow[] = [];

  return { rows, record: (row) => void rows.push(row) };
}

function mounted(ports: Partial<RestRuntimeMembers> = {}): Hono {
  const runtime = createRestRuntime({
    authorization: authorizationPort,
    identity: organizationDoor,
    doors: { instance_admin: instanceAdminDoor },
    ...ports,
  });

  return runtime.mount(keys.router(), {
    app: () => application,
    credential: "organization",
    onError: createErrorHandler(),
  });
}

async function call(app: Hono, method: string, path: string, body?: unknown): Promise<Response> {
  return app.request(path, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });
}

describe("given a route that raises a credential kind of its own", () => {
  describe("when a caller reaches that route", () => {
    /** @scenario "A route declares the credential kind it answers behind" */
    it("resolves the route's own door rather than the family's", async () => {
      const sink = recordingSink();
      const answer = await call(mounted({ audit: sink }), "POST", "/api/api-keys", { name: "one" });

      expect(answer.status).toBe(200);
      await expect(answer.json()).resolves.toEqual({ id: "key-one" });
      expect(createHandlerSawIdentity).toEqual({ actor: null, scope: null });
    });
  });

  describe("when a caller reaches a route that raised nothing", () => {
    /** @scenario "A route declares the credential kind it answers behind" */
    it("resolves the family's own door", async () => {
      const answer = await call(
        mounted({ audit: recordingSink() }),
        "GET",
        "/api/api-keys/key-one",
      );

      await expect(answer.json()).resolves.toEqual({ id: "key-one", door: "read" });
      expect(readHandlerSawScope).toEqual({ tier: "organization", id: "organization-1" });
    });
  });

  describe("when the runtime opens no door of the kind the route raised", () => {
    it("refuses the mount naming the route and the kind", () => {
      const runtime = createRestRuntime({
        authorization: authorizationPort,
        identity: organizationDoor,
        audit: recordingSink(),
      });

      expect(() =>
        runtime.mount(keys.router(), {
          app: () => application,
          credential: "organization",
          onError: createErrorHandler(),
        }),
      ).toThrow(/answers behind the "instance_admin" door/);
    });
  });
});

describe("given a route that declares the trail it leaves", () => {
  describe("when the route answers", () => {
    /** @scenario "A route declares the trail it leaves" */
    it("writes one row from the actor, the params and the result id", async () => {
      const sink = recordingSink();

      await call(mounted({ audit: sink }), "POST", "/api/api-keys", { name: "one" });

      expect(sink.rows).toEqual([
        {
          actorId: null,
          action: "api-key.created",
          scope: null,
          params: {},
          resultId: "key-one",
        },
      ]);
    });
  });

  describe("when the route throws a handled error", () => {
    /** @scenario "A refused route leaves the refusal on the trail" */
    it("writes one row carrying the error code", async () => {
      const sink = recordingSink();

      const answer = await call(mounted({ audit: sink }), "DELETE", "/api/api-keys/key-one");

      expect(answer.status).toBe(410);

      expect(sink.rows).toEqual([
        {
          actorId: "user-1",
          action: "api-key.deleted",
          scope: { tier: "organization", id: "organization-1" },
          params: { id: "key-one" },
          resultId: null,
          errorCode: "endpoint_withdrawn",
        },
      ]);
    });
  });

  describe("when the call arrives from an address with a user agent", () => {
    it("carries the address the door resolved and the user agent", async () => {
      const sink = recordingSink();
      const request = new Request("http://localhost/api/api-keys/key-one", {
        method: "DELETE",
        headers: { "user-agent": "Mozilla/5.0 (audit test)" },
      });
      ClientAddress.classifyByAddress().handle({ request, socketAddress: "203.0.113.7" });

      await mounted({ audit: sink }).request(request);

      expect(sink.rows).toEqual([
        expect.objectContaining({
          actorId: "user-1",
          ipAddress: "203.0.113.7",
          userAgent: "Mozilla/5.0 (audit test)",
        }),
      ]);
    });
  });

  describe("when an organization key makes the call", () => {
    function keyDoor(userId: string | null): RestIdentity {
      return {
        authenticate: ({ request }) => {
          recordOrganizationCredential(request, {
            type: "apiKey-org",
            apiKeyId: "key-9",
            userId,
            organizationId: "organization-1",
          });

          return {
            actor: userId ? { type: "user", id: userId } : null,
            scope: { tier: "organization", id: "organization-1" },
          };
        },
      };
    }

    it("names the key beside no actor for a key acting as nobody", async () => {
      const sink = recordingSink();

      await call(mounted({ audit: sink, identity: keyDoor(null) }), "DELETE", "/api/api-keys/k");

      expect(sink.rows).toEqual([expect.objectContaining({ actorId: null, apiKeyId: "key-9" })]);
    });

    it("names the key's person and the key for a personal key", async () => {
      const sink = recordingSink();

      await call(
        mounted({ audit: sink, identity: keyDoor("user-7") }),
        "DELETE",
        "/api/api-keys/k",
      );

      expect(sink.rows).toEqual([
        expect.objectContaining({ actorId: "user-7", apiKeyId: "key-9" }),
      ]);
    });
  });

  describe("when a route answers on a runtime with no audit sink", () => {
    it("refuses the mount naming the action", () => {
      const runtime = createRestRuntime({
        authorization: authorizationPort,
        identity: organizationDoor,
        doors: { instance_admin: instanceAdminDoor },
      });

      expect(() =>
        runtime.mount(keys.router(), {
          app: () => application,
          credential: "organization",
          onError: createErrorHandler(),
        }),
      ).toThrow(/declares the audit action "api-key.created"/);
    });
  });

  describe("when a route names an action that is not dotted segments", () => {
    it("refuses the declaration where it is written", () => {
      expect(() =>
        defineRestRouter(KeyApi)
          .withNamespace("api-keys")
          .withVersion(VERSION)
          .post("/", "createApiKey")
          .withAudit("Created An API Key"),
      ).toThrow(/must be dotted segments/);
    });

    it("accepts the tRPC path the same write audits under", () => {
      expect(() =>
        defineRestRouter(KeyApi)
          .withNamespace("api-keys")
          .withVersion(VERSION)
          .post("/", "createApiKey")
          .withAudit("modelProvider.role_defined"),
      ).not.toThrow();
    });
  });

  describe("when a write route says nothing about its trail", () => {
    it("refuses the route where it is written, naming the operation", () => {
      expect(() =>
        defineRestRouter(KeyApi)
          .withNamespace("api-keys")
          .withVersion(VERSION)
          .post("/", "createApiKey")
          .withPermission("organization:manage")
          .handle(async () => void 0),
      ).toThrow(/REST createApiKey is a write route: declare withAudit/);
    });

    it("lets a read route leave it unsaid", () => {
      expect(() =>
        defineRestRouter(KeyApi)
          .withNamespace("api-keys")
          .withVersion(VERSION)
          .get("/", "createApiKey")
          .withPermission("organization:view")
          .handle(async () => void 0),
      ).not.toThrow();
    });
  });

  describe("when a route declares whether it leaves a trail twice", () => {
    it("refuses withoutAudit after withAudit", () => {
      expect(() =>
        defineRestRouter(KeyApi)
          .withNamespace("api-keys")
          .withVersion(VERSION)
          .post("/", "createApiKey")
          .withAudit("api-key.created")
          .withoutAudit("ingestion"),
      ).toThrow(/already declared withAudit\(\) or withoutAudit\(\)/);
    });

    it("refuses withoutAudit with no reason", () => {
      expect(() =>
        defineRestRouter(KeyApi)
          .withNamespace("api-keys")
          .withVersion(VERSION)
          .post("/", "createApiKey")
          .withoutAudit(" "),
      ).toThrow(/needs a reason/);
    });
  });
});
