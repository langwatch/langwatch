/**
 * What gates a REST route before its handler runs, and what a public description refuses to
 * advertise. Specs: specs/security/api-endpoint-authorization.feature and
 * specs/server/feature-application-and-transports.feature.
 */

import { NotFoundError } from "@langwatch/handled-error";
import { moduleApi } from "@langwatch/module";
import type { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { anyAuthenticated } from "../../access/access.ts";
import { createErrorHandler, ProjectInvalidCredentialsError } from "../../errors.ts";
import { allRegisteredRoutes } from "../../route-registry.ts";
import { defineRestRouter } from "../declaration.ts";
import { securityForCredentialClass } from "../openapi.ts";
import { createRestRuntime } from "../runtime.ts";
import { assertEveryRouteDeclared, undeclaredRoutes } from "../security.ts";

const VERSION = "2026-09-08";
const ORGANIZATION = { tier: "organization", id: "organization-1" } as const;
const SECRET = "the-shared-secret";

interface GateApi {
  getNote(input: { id: string }): Promise<{ id: string }>;
  getReport(input: { projectId: string }): Promise<{ projectId: string }>;
}

const GateApi = moduleApi<GateApi>()("annotation");

const reached: string[] = [];

const forwarder = defineRestRouter(GateApi)
  .withNamespace("forwarded")
  .withVersion(VERSION)
  .withAddressing("v1-only")
  .withCredential("organization")
  .get("/*", "forwardInternal")
  .withAccess(anyAuthenticated({ reason: "the shared secret is the whole gate" }))
  .withRawResponse({ produces: ["application/json"] })
  .anyMethod()
  .handle(({ request }) => {
    reached.push(request.method);

    return new Response("forwarded", { status: 200, headers: { "Content-Type": "text/plain" } });
  })
  .build();

function forwarderApp(): Hono {
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({ actor: null, scope: ORGANIZATION }),
      identify: ({ request }) => {
        if (request.headers.get("X-Internal-Secret") !== SECRET) {
          throw new ProjectInvalidCredentialsError();
        }

        return { actor: { type: "api_key", id: "internal" }, scope: ORGANIZATION };
      },
    },
  });

  return runtime.mount(forwarder.router(), {
    app: () => ({
      getNote: async ({ id }) => ({ id }),
      getReport: async ({ projectId }) => ({ projectId }),
    }),
    onError: createErrorHandler(),
  });
}

describe("a route that answers every method behind a shared secret", () => {
  /** @scenario "An any-method route enforces its policy on every method" */
  it("refuses GET, POST and DELETE without the secret before the handler, and answers each with it", async () => {
    const app = forwarderApp();
    reached.length = 0;

    for (const method of ["GET", "POST", "DELETE"]) {
      const refused = await app.request("/api/v1/forwarded/anything", { method });

      expect(refused.status).toBe(401);
    }

    expect(reached).toEqual([]);

    for (const method of ["GET", "POST", "DELETE"]) {
      const answered = await app.request("/api/v1/forwarded/anything", {
        method,
        headers: { "X-Internal-Secret": SECRET },
      });

      expect(answered.status).toBe(200);
    }

    expect(reached).toEqual(["GET", "POST", "DELETE"]);
  });
});

const notes = defineRestRouter(GateApi)
  .withNamespace("gated-notes")
  .withVersion(VERSION)
  .withCredential("organization")

  .get("/:id", "getNote")
  .withParams(z.object({ id: z.string() }))
  .withPermission("annotations:view")
  .withOutput(z.object({ id: z.string() }))
  .handle(async ({ app, input }) => app.getNote({ id: input.id }))

  .get("/reports/:projectId", "getReport")
  .withParams(
    z.object({
      projectId: z
        .string()
        .min(4)
        .transform((value) => value.toLowerCase()),
    }),
  )
  .withPermission("project:view", { at: "route", param: "projectId" })
  .withOutput(z.object({ projectId: z.string() }))
  .handle(async ({ app, input }) => app.getReport({ projectId: input.projectId }))
  .build();

function notesApp({ getNote }: { getNote?: GateApi["getNote"] } = {}) {
  const authorize = vi.fn(() => ({ permitted: true, organizationRole: null }));
  const getReport = vi.fn(async ({ projectId }: { projectId: string }) => ({ projectId }));

  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({ actor: { type: "api_key", id: "key-1" }, scope: ORGANIZATION }),
      authorize,
    },
  });

  const app = runtime.mount(notes.router(), {
    app: () => ({ getNote: getNote ?? (async ({ id }) => ({ id })), getReport }),
    onError: createErrorHandler(),
  });

  return { app, authorize, getReport };
}

describe("a route whose permission is bound to a request field", () => {
  /** @scenario "Authorization is decided after the input is validated" */
  it("decides at the scope the validated field names, never the one the request spelled", async () => {
    const { app, authorize, getReport } = notesApp();

    const response = await app.request("/api/v1/gated-notes/reports/PROJECT-1");

    expect(response.status).toBe(200);

    expect(authorize).toHaveBeenCalledTimes(1);

    expect(authorize.mock.calls[0]).toMatchObject([
      { permission: "project:view", target: { tier: "project", id: "project-1" } },
    ]);

    expect(getReport).toHaveBeenCalledWith({ projectId: "project-1" });
  });

  /** @scenario "Authorization is decided after the input is validated" */
  it("asks nothing of authorization when the field is refused, so no scope is read from it", async () => {
    const { app, authorize, getReport } = notesApp();

    const response = await app.request("/api/v1/gated-notes/reports/abc");

    expect(response.status).toBe(422);
    expect(authorize).not.toHaveBeenCalled();
    expect(getReport).not.toHaveBeenCalled();
  });
});

describe("a REST handler that throws a handled error", () => {
  /** @scenario "The transport owns the failure" */
  it("is answered with the transport's refusal and the error's own code and status", async () => {
    const { app } = notesApp({
      getNote: async ({ id }) => {
        throw new NotFoundError("annotation_not_found", { resource: "Annotation", id });
      },
    });

    const response = await app.request("/api/v1/gated-notes/note-1");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "annotation_not_found" });
  });
});

describe("the cross-check over a composed router", () => {
  /** @scenario "A mounted route with no declared policy stops the boot" */
  it("refuses to finish booting, naming the method and path of every route nothing declared", () => {
    const app = forwarderApp();

    app.get("/api/v1/forwarded-stray/one", (context) => context.json({}));
    app.post("/api/v1/forwarded-stray/two", (context) => context.json({}));

    expect(undeclaredRoutes({ app, registry: allRegisteredRoutes() })).toEqual([
      "GET /api/v1/forwarded-stray/one",
      "POST /api/v1/forwarded-stray/two",
    ]);

    let refusal = "";

    try {
      assertEveryRouteDeclared({ app, registry: allRegisteredRoutes() });
    } catch (failure) {
      refusal = (failure as Error).message;
    }

    expect(refusal).toContain("GET /api/v1/forwarded-stray/one");
    expect(refusal).toContain("POST /api/v1/forwarded-stray/two");
  });
});

describe("the security a public description publishes", () => {
  /** @scenario "An operation no API client can authenticate is never published" */
  it("fails generation, naming the operation, for a browser session and for an internal secret", () => {
    for (const credentialClass of ["session", "internal"] as const) {
      expect(() =>
        securityForCredentialClass({
          operationKey: "GET /api/v1/forwarded/anything",
          credentialClass,
        }),
      ).toThrow(/GET \/api\/v1\/forwarded\/anything is documented in the public API description/);
    }
  });
});
