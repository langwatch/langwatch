/**
 * @vitest-environment node
 *
 * What the `/api/model-providers` door makes of the failures its service
 * raises.
 *
 * The write route used to wrap `upsert` in `catch (error) { if (error
 * instanceof Error) throw new HTTPException(400, ...) }`. Every failure the
 * service raises is a `HandledError`, and a `HandledError` is an `Error`, so
 * that caught all of them: a 404 left as a 400, a 409 left as a 400, and the
 * code the client keys its copy off replaced by `http_error` — the framework
 * boundary discards an `HTTPException`'s message, so even the prose it tried
 * to pass through never arrived.
 *
 * These cases assert the statuses and codes reach the caller intact.
 */
import {
  createAppRestSecurity,
  type AppRestSecurity,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import {
  ModelProviderNotFoundError,
  ModelProviderRoutingHandleTakenError,
  type ModelProviderService,
} from "@langwatch/model-provider-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createModelProvidersRestApp } from "../model-provider.api";

/**
 * The process boundary, reduced to the one fact these tests read back: a
 * handled refusal keeps its own status and its own code.
 */
const boundaryErrorHandler: ErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    const serialized = error.serialize();
    return c.json({ error: serialized.code }, serialized.httpStatus as 400);
  }
  return c.json({ error: "internal_server_error" }, 500);
};

function testSecurity(): AppRestSecurity {
  const pass: MiddlewareHandler = async (_c, next) => next();
  const authenticateProject: MiddlewareHandler = async (c, next) => {
    c.set("project", {
      id: "project-1",
      name: "Project One",
      slug: "project-one",
      teamId: "team-1",
      organizationId: "organization-1",
      isPersonal: false,
      ownerUserId: null,
    });
    await next();
  };

  const ports: RestApiServicePorts = {
    appContext: async (_c, next) => next(),
    requestLogger: () => async (_c, next) => next(),
    requestTracer: () => async (_c, next) => next(),
    legacyErrorHandler: boundaryErrorHandler,
    canonicalErrorHandler: boundaryErrorHandler,
    authenticateProject: () => authenticateProject,
    authorizeProjectPermission: () => pass,
    authorizeApiKeyCeiling: () => pass,
    authenticateOrganization: () => pass,
    authorizeOrganizationPermission: () => pass,
    authorizeRouteProjectPermission: () => pass,
    authenticateOrganizationThrowing: pass,
    authorizeOrganizationPermissionThrowing: () => pass,
  };

  return createAppRestSecurity(ports);
}

function buildApi(upsert: () => Promise<never>) {
  const modelProviders = {
    upsert: vi.fn(upsert),
    getForProject: vi.fn(async () => []),
  } as unknown as ModelProviderService;

  const organizations = {
    getTeamById: vi.fn(async () => ({ organizationId: "organization-1" })),
  } as unknown as OrganizationService;

  const family = createModelProvidersRestApp({
    security: testSecurity(),
    modelProviders: () => modelProviders,
    organizations: () => organizations,
  });

  return { hono: family.hono, modelProviders };
}

function upsertRequest() {
  return new Request("http://localhost/api/model-providers/openai", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: true }),
  });
}

describe("the model-providers write route", () => {
  describe("when the service refuses with a not-found", () => {
    it("answers 404 with the failure's own code", async () => {
      const { hono } = buildApi(async () => {
        throw new ModelProviderNotFoundError();
      });

      const response = await hono.request(upsertRequest());

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        error: "model_provider_not_found",
      });
    });
  });

  describe("when the service refuses with a conflict", () => {
    it("answers 409 with the failure's own code", async () => {
      const { hono } = buildApi(async () => {
        throw new ModelProviderRoutingHandleTakenError({ handle: "taken" });
      });

      const response = await hono.request(upsertRequest());

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: "model_provider_routing_handle_taken",
      });
    });
  });
});
