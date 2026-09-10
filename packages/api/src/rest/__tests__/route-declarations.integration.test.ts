/**
 * The two cross-cutting concerns a ROUTE declares for itself: the credential
 * kind it answers behind, and the trail it leaves. Both are fulfilled by the
 * runtime, so the app carries neither.
 *
 * Spec: specs/server/declarative-process-composition.feature.
 */

import { moduleApi } from "@langwatch/runtime-composition";
import type { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createErrorHandler, EndpointWithdrawnError } from "../../errors.ts";
import { defineRestRouter } from "../declaration.ts";
import {
  createRestRuntime,
  type RestAuditRow,
  type RestIdentityPort,
  type RestRuntimePorts,
} from "../runtime.ts";

const VERSION = "2026-09-10";

interface KeyApi {
  create(input: { name: string }): Promise<{ id: string }>;
  read(input: { id: string }): Promise<{ id: string; door: string }>;
  withdraw(input: { id: string }): Promise<{ id: string }>;
}

const KeyApi = moduleApi<KeyApi>("api-key");

const application: KeyApi = {
  create: async ({ name }) => ({ id: `key-${name}` }),
  read: async ({ id }) => ({ id, door: "read" }),
  withdraw: async () => {
    throw new EndpointWithdrawnError();
  },
};

/**
 * The family answers behind an organization credential; its create raises the
 * instance administrator's door for itself, and both writes leave a trail.
 */
const keys = defineRestRouter(KeyApi)
  .withNamespace("api-keys")
  .withVersion(VERSION)
  .withCredential("organization")

  .post("/", "createApiKey")
  .withCredential("instance-admin")
  .withAudit("api-key.created")
  .withInput(z.object({ name: z.string() }))
  .withPermission("organization:manage")
  .withOutput(z.object({ id: z.string() }))
  .handle(async ({ app, input, actor, scope }) => {
    expect(actor).toBeNull();
    expect(scope).toBeNull();

    return app.create({ name: input.name });
  })

  .get("/:id", "getApiKey")
  .withParams(z.object({ id: z.string() }))
  .withPermission("organization:view")
  .withOutput(z.object({ id: z.string(), door: z.string() }))
  .handle(async ({ app, input, scope }) => {
    expect(scope).toEqual({ tier: "organization", id: "organization-1" });

    return app.read({ id: input.id });
  })

  .delete("/:id", "deleteApiKey")
  .withParams(z.object({ id: z.string() }))
  .withAudit("api-key.deleted")
  .withPermission("organization:manage")
  .withOutput(z.object({ id: z.string() }))
  .handle(async ({ app, input }) => app.withdraw({ id: input.id }))
  .build();

const organizationDoor: RestIdentityPort = {
  authenticate: () => ({
    actor: { type: "user", id: "user-1" },
    scope: { tier: "organization", id: "organization-1" },
  }),
};

/** The instance administrator's bearer names no tenant and nobody inside one. */
const instanceAdminDoor: RestIdentityPort = {
  authenticate: () => ({ actor: null, scope: null }),
};

function recordingSink(): { rows: RestAuditRow[]; record(row: RestAuditRow): void } {
  const rows: RestAuditRow[] = [];

  return { rows, record: (row) => void rows.push(row) };
}

function mounted(ports: Partial<RestRuntimePorts> = {}): Hono {
  const runtime = createRestRuntime({
    identity: organizationDoor,
    doors: { "instance-admin": instanceAdminDoor },
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
    });
  });

  describe("when a caller reaches a route that raised nothing", () => {
    /** @scenario "A route declares the credential kind it answers behind" */
    it("resolves the family's own door", async () => {
      const answer = await call(mounted({ audit: recordingSink() }), "GET", "/api/api-keys/key-one");

      await expect(answer.json()).resolves.toEqual({ id: "key-one", door: "read" });
    });
  });

  describe("when the runtime opens no door of the kind the route raised", () => {
    it("refuses the mount naming the route and the kind", () => {
      const runtime = createRestRuntime({ identity: organizationDoor, audit: recordingSink() });

      expect(() =>
        runtime.mount(keys.router(), {
          app: () => application,
          credential: "organization",
          onError: createErrorHandler(),
        }),
      ).toThrow(/answers behind the "instance-admin" door/);
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

  describe("when a route answers on a runtime with no audit sink", () => {
    it("refuses the mount naming the action", () => {
      const runtime = createRestRuntime({
        identity: organizationDoor,
        doors: { "instance-admin": instanceAdminDoor },
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

  describe("when a route names an action that is not dotted lower kebab case", () => {
    it("refuses the declaration where it is written", () => {
      expect(() =>
        defineRestRouter(KeyApi)
          .withNamespace("api-keys")
          .withVersion(VERSION)
          .post("/", "createApiKey")
          .withAudit("Created An API Key"),
      ).toThrow(/must be dotted lower kebab case/);
    });
  });
});
